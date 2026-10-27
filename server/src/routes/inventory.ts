import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { eq, and, sql, desc, asc } from 'drizzle-orm';
import { requireAuth } from '../services/auth.js';
import { buildSession } from './auth.js';
import { AppError } from '../util/errors.js';
import { ARCANE_CHEST_HARD_PITY, RARITY_ORDER } from '../constants.js';
import { randomUUID } from 'node:crypto';

export async function registerInventoryRoutes(app: FastifyInstance) {
  app.get('/api/inventory/fish', async (req, reply) => {
    const player = await requireAuth(req, reply);
    return { ...await fishInventory(player.id), serverTime: new Date().toISOString() };
  });

  app.post('/api/inventory/fish/sell', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const parsed = z.object({
      items: z.array(z.object({ fishId: z.string().min(1), quantity: z.number().int().positive() })).min(1).max(1000),
    }).parse(req.body as any);
    const requested = parsed.items;

    const quantities = new Map<string, number>();
    for (const item of requested) quantities.set(item.fishId, (quantities.get(item.fishId) ?? 0) + item.quantity);

    const [inventoryRows, fishDefs] = await Promise.all([
      db.select().from(schema.playerInventoryFish).where(eq(schema.playerInventoryFish.playerId, player.id)),
      db.select().from(schema.fish),
    ]);
    const inventoryMap = new Map(inventoryRows.map((row) => [row.fishId, row]));
    const fishDefMap = new Map(fishDefs.map((fish) => [fish.id, fish]));
    let goldEarned = 0;
    let soldQuantity = 0;
    const soldItems: Array<{ fishId: string; name: string; quantity: number; gold: number }> = [];

    for (const [fishId, quantity] of quantities) {
      const inventory = inventoryMap.get(fishId);
      const fish = fishDefMap.get(fishId);
      if (!fish) throw new AppError('FISH_NOT_FOUND', '鱼种不存在。');
      if (!inventory || inventory.quantity < quantity) throw new AppError('INSUFFICIENT_FISH', `${fish.name}数量不足。`);
      if (inventory.isLocked) throw new AppError('FISH_LOCKED', `${fish.name}已锁定，无法出售。`);
      const gold = fish.sellPrice * quantity;
      goldEarned += gold;
      soldQuantity += quantity;
      soldItems.push({ fishId, name: fish.name, quantity, gold });
    }

    await db.transaction(async (tx) => {
      for (const item of soldItems) {
        await tx.update(schema.playerInventoryFish)
          .set({ quantity: sql`${schema.playerInventoryFish.quantity} - ${item.quantity}` })
          .where(and(eq(schema.playerInventoryFish.playerId, player.id), eq(schema.playerInventoryFish.fishId, item.fishId)));
      }
      await tx.update(schema.players)
        .set({
          gold: sql`${schema.players.gold} + ${goldEarned}`,
          npcFishSoldQuantity: sql`${schema.players.npcFishSoldQuantity} + ${soldQuantity}`,
          npcFishSoldGold: sql`${schema.players.npcFishSoldGold} + ${goldEarned}`,
        })
        .where(eq(schema.players.id, player.id));
    });

    return {
      fish: (await fishInventory(player.id)).fish,
      player: await fullPlayer(player.id),
      goldEarned,
      soldQuantity,
      soldItems,
      serverTime: new Date().toISOString(),
    };
  });
  app.patch('/api/inventory/fish/:fishId/lock', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const fishId = String((req.params as any).fishId);
    const body = z.object({ isLocked: z.boolean(), source: z.enum(['manual', 'mastery']).optional() }).parse(req.body as any);
    const updated = (await db.update(schema.playerInventoryFish)
      .set({ isLocked: body.isLocked })
      .where(and(eq(schema.playerInventoryFish.playerId, player.id), eq(schema.playerInventoryFish.fishId, fishId)))
      .returning())[0];
    if (!updated) throw new AppError('FISH_NOT_FOUND', '鱼获不存在。');
    return { success: true, isLocked: updated.isLocked, serverTime: new Date().toISOString() };
  });

  app.patch('/api/inventory/fish/settings', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({ autoLockMasteryFish: z.boolean() }).parse(req.body as any);
    const key = `fish-inventory-settings:${player.id}`;
    await db.insert(schema.globalSettings).values({ key, value: body })
      .onConflictDoUpdate({ target: schema.globalSettings.key, set: { value: body, updatedAt: new Date() } });
    return { settings: body, serverTime: new Date().toISOString() };
  });

  app.get('/api/inventory/gear', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const q = req.query as any;
    const filters: any[] = [eq(schema.gearItems.ownerId, player.id)];
    if (q.equipped === 'true') filters.push(eq(schema.gearItems.isEquipped, true));
    if (q.equipped === 'false') filters.push(eq(schema.gearItems.isEquipped, false));
    if (q.marketListed === 'true') filters.push(eq(schema.gearItems.isMarketListed, true));
    if (q.marketListed === 'false') filters.push(eq(schema.gearItems.isMarketListed, false));
    if (q.locked === 'true') filters.push(eq(schema.gearItems.isLocked, true));
    if (q.locked === 'false') filters.push(eq(schema.gearItems.isLocked, false));
    if (q.slot) filters.push(eq(schema.gearItems.slot, String(q.slot)));
    if (q.search) filters.push(sql`${schema.gearItems.name} ilike ${'%' + String(q.search) + '%'}`);
    const rarityValues = String(q.rarities ?? q.rarity ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    if (rarityValues.length > 0) filters.push(sql`${schema.gearItems.rarity} = any(${rarityValues})`);
    if (q.stat && ['strength', 'intelligence', 'luck', 'endurance'].includes(String(q.stat))) {
      filters.push(sql`coalesce((${schema.gearItems.baseStats}->>${String(q.stat)})::int, 0) > 0`);
    }

    const direction = q.direction === 'asc' ? 'asc' : 'desc';
    const rarityCase = sql.raw(`CASE ${schema.gearItems.rarity.name} ${RARITY_ORDER.map((rarity, index) => `WHEN '${rarity}' THEN ${index}`).join(' ')} ELSE -1 END`);
    const sortColumns: Record<string, any> = {
      acquiredAt: schema.gearItems.acquiredAt,
      rarity: rarityCase,
      quality: schema.gearItems.quality,
      upgradeLevel: schema.gearItems.upgradeLevel,
      strength: sql`coalesce((${schema.gearItems.baseStats}->>'strength')::int, 0)`,
      intelligence: sql`coalesce((${schema.gearItems.baseStats}->>'intelligence')::int, 0)`,
      luck: sql`coalesce((${schema.gearItems.baseStats}->>'luck')::int, 0)`,
      endurance: sql`coalesce((${schema.gearItems.baseStats}->>'endurance')::int, 0)`,
    };
    const sort = sortColumns[String(q.sort ?? 'rarity')] ?? sortColumns.rarity;
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)));
    const [rows, equippedRows, currentPlayer, itemCounts] = await Promise.all([
      db.select().from(schema.gearItems).where(and(...filters))
        .orderBy(direction === 'asc' ? asc(sort) : desc(sort), asc(schema.gearItems.id))
        .limit(limit),
      db.select().from(schema.gearItems).where(and(eq(schema.gearItems.ownerId, player.id), eq(schema.gearItems.isEquipped, true))),
      playerRow(player.id),
      loadItemCounts(player.id),
    ]);
    const totalStats = { strength: 0, intelligence: 0, luck: 0, endurance: 0 };
    for (const gear of equippedRows) {
      const publicGear = gearPublic(gear);
      for (const key of ['strength', 'intelligence', 'luck', 'endurance'] as const) totalStats[key] += publicGear.effectiveStats[key] ?? 0;
    }
    return {
      gear: rows.map(gearPublic),
      nextCursor: null,
      totalStats,
      relics: currentPlayer.relics,
      gold: currentPlayer.gold,
      crystalBalances: {
        legendary: itemCounts.legendary_gear_crystal ?? 0,
        mythic: itemCounts.mythic_gear_crystal ?? 0,
        exotic: itemCounts.exotic_gear_crystal ?? 0,
      },
    };
  });

  app.post('/api/inventory/gear/:gearId/toggle-equipped', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const gearId = String((req.params as any).gearId);
    const gear = (await db.select().from(schema.gearItems).where(and(eq(schema.gearItems.id, gearId), eq(schema.gearItems.ownerId, player.id))))[0];
    if (!gear) throw new AppError('GEAR_NOT_FOUND', '装备不存在。');
    if (gear.isMarketListed) throw new AppError('GEAR_MARKET_LISTED', '上架中的装备无法穿戴。');

    await db.transaction(async (tx) => {
      if (!gear.isEquipped) {
        // unequip same-slot items
        if (gear.slot === 'ring') {
          const rings = await tx.select().from(schema.gearItems).where(and(
            eq(schema.gearItems.ownerId, player.id), eq(schema.gearItems.slot, 'ring'), eq(schema.gearItems.isEquipped, true),
          ));
          if (rings.length >= 2) {
            const oldest = rings.sort((a, b) => a.acquiredAt.getTime() - b.acquiredAt.getTime())[0];
            await tx.update(schema.gearItems).set({ isEquipped: false }).where(eq(schema.gearItems.id, oldest.id));
          }
        } else {
          await tx.update(schema.gearItems).set({ isEquipped: false })
            .where(and(eq(schema.gearItems.ownerId, player.id), eq(schema.gearItems.slot, gear.slot), eq(schema.gearItems.isEquipped, true)));
        }
        await tx.update(schema.gearItems).set({ isEquipped: true }).where(eq(schema.gearItems.id, gear.id));
      } else {
        await tx.update(schema.gearItems).set({ isEquipped: false }).where(eq(schema.gearItems.id, gear.id));
      }
    });
    return { success: true };
  });

  app.post('/api/inventory/gear/sell', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({ gearIds: z.array(z.string()).min(1) }).parse(req.body as any);
    let total = 0;
    await db.transaction(async (tx) => {
      for (const id of body.gearIds) {
        const gear = (await tx.select().from(schema.gearItems).where(and(eq(schema.gearItems.id, id), eq(schema.gearItems.ownerId, player.id))))[0];
        if (!gear || gear.isMarketListed) continue;
        const value = gearValue(gear);
        total += value;
        await tx.delete(schema.gearItems).where(eq(schema.gearItems.id, id));
      }
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} + ${total}` }).where(eq(schema.players.id, player.id));
    });
    return { player: await fullPlayer(player.id), goldEarned: total, soldCount: body.gearIds.length, serverTime: new Date().toISOString() };
  });

  app.post('/api/inventory/gear/sale-preview', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({ gearIds: z.array(z.string()) }).parse(req.body as any);
    const rows = await db.select().from(schema.gearItems).where(eq(schema.gearItems.ownerId, player.id));
    const rowsById = new Map(rows.map((r) => [r.id, r]));
    let total = 0;
    const items = body.gearIds.map((id) => {
      const g = rowsById.get(id);
      if (!g || g.isMarketListed) return null;
      const v = gearValue(g);
      total += v;
      return { gearId: g.id, name: g.name, rarity: g.rarity, slot: g.slot, price: v };
    }).filter(Boolean);
    return { items, total, count: items.length };
  });

  app.get('/api/inventory/items', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const counts = await loadItemCounts(player.id);
    const rows = await playerRow(player.id);
    return {
      items: INVENTORY_ITEMS.map((item) => ({ ...item, sellerFeeBasisPoints: item.marketSellerFeeBasisPoints, quantity: counts[item.itemId] ?? 0 })),
      balances: { relics: rows.relics, fragments: rows.fragments },
      serverTime: new Date().toISOString(),
    };
  });

  app.post('/api/inventory/items/:itemId/open', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const itemId = String((req.params as any).itemId);
    const item = INVENTORY_ITEMS.find((entry) => entry.itemId === itemId);
    if (!item) throw new AppError('ITEM_NOT_FOUND', '道具不存在。');
    const counts = await loadItemCounts(player.id);
    if ((counts[itemId] ?? 0) < 1) throw new AppError('INSUFFICIENT_ITEMS', '道具数量不足。');
    if (!item.openReward) throw new AppError('ITEM_NOT_OPENABLE', '该道具无法开启。');
    counts[itemId] -= 1;
    await saveItemCounts(player.id, counts);
    await db.update(schema.players).set({
      relics: sql`${schema.players.relics} + ${item.openReward.relics ?? 0}`,
      fragments: sql`${schema.players.fragments} + ${item.openReward.fragments ?? 0}`,
    }).where(eq(schema.players.id, player.id));
    const rows = await playerRow(player.id);
    return {
      items: INVENTORY_ITEMS.map((entry) => ({ ...entry, sellerFeeBasisPoints: entry.marketSellerFeeBasisPoints, quantity: counts[entry.itemId] ?? 0 })),
      balances: { relics: rows.relics, fragments: rows.fragments },
      reward: item.openReward,
      serverTime: new Date().toISOString(),
    };
  });

  app.get('/api/inventory/fish/:fishId/titan-values', async (req, reply) => {
    await requireAuth(req, reply);
    return { values: [], nextCursor: null, serverTime: new Date().toISOString() };
  });

  app.get('/api/inventory/chests', async (req, reply) => {
    const player = await requireAuth(req, reply);
    return { ...await chestList(player.id), serverTime: new Date().toISOString() };
  });

  app.post('/api/inventory/gear/:gearId/upgrade', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const gearId = String((req.params as any).gearId);
    const gear = (await db.select().from(schema.gearItems).where(and(eq(schema.gearItems.id, gearId), eq(schema.gearItems.ownerId, player.id))))[0];
    if (!gear) throw new AppError('GEAR_NOT_FOUND', '装备不存在。');
    if (gear.isMarketListed) throw new AppError('GEAR_MARKET_LISTED', '上架中的装备无法强化。');

    const cost = upgradeCost(gear);
    if (player.gold < cost.gold) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');

    const success = Math.random() < 0.8;
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({
        gold: sql`${schema.players.gold} - ${cost.gold}`,
        totalGearUpgrades: sql`${schema.players.totalGearUpgrades} + 1`,
      }).where(eq(schema.players.id, player.id));
      if (success) {
        await tx.update(schema.gearItems).set({ upgradeLevel: gear.upgradeLevel + 1, updatedAt: new Date() }).where(eq(schema.gearItems.id, gear.id));
      }
    });
    const updated = (await db.select().from(schema.gearItems).where(eq(schema.gearItems.id, gear.id)))[0];
    return { gear: gearPublic(updated), success, player: await fullPlayer(player.id), serverTime: new Date().toISOString() };
  });

  app.post('/api/inventory/gear/:gearId/reroll', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const gearId = String((req.params as any).gearId);
    const gear = (await db.select().from(schema.gearItems).where(and(eq(schema.gearItems.id, gearId), eq(schema.gearItems.ownerId, player.id))))[0];
    if (!gear) throw new AppError('GEAR_NOT_FOUND', '装备不存在。');
    const cost = rerollCost(gear);
    if (player.relics < cost) throw new AppError('INSUFFICIENT_RELICS', '遗物不足。');

    const template = (await db.select().from(schema.gearTemplates).where(eq(schema.gearTemplates.id, gear.templateId)))[0];
    const baseStats = template ? rollStats(template.baseStatRange, gear.quality) : gear.baseStats;

    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ relics: sql`${schema.players.relics} - ${cost}` }).where(eq(schema.players.id, player.id));
      await tx.update(schema.gearItems).set({ baseStats, updatedAt: new Date() }).where(eq(schema.gearItems.id, gear.id));
    });
    const updated = (await db.select().from(schema.gearItems).where(eq(schema.gearItems.id, gear.id)))[0];
    return { gear: gearPublic(updated), player: await fullPlayer(player.id), serverTime: new Date().toISOString() };
  });

  app.post('/api/inventory/gear/:gearId/salvage', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const gearId = String((req.params as any).gearId);
    const gear = (await db.select().from(schema.gearItems).where(and(eq(schema.gearItems.id, gearId), eq(schema.gearItems.ownerId, player.id))))[0];
    if (!gear) throw new AppError('GEAR_NOT_FOUND', '装备不存在。');
    const relics = salvageRelics(gear);
    await db.transaction(async (tx) => {
      await tx.delete(schema.gearItems).where(eq(schema.gearItems.id, gear.id));
      await tx.update(schema.players).set({ relics: sql`${schema.players.relics} + ${relics}` }).where(eq(schema.players.id, player.id));
    });
    return { relicsGained: relics, player: await fullPlayer(player.id), serverTime: new Date().toISOString() };
  });

  app.put('/api/inventory/gear/:gearId/lock', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const gearId = String((req.params as any).gearId);
    const locked = Boolean((req.body as any)?.locked);
    await db.update(schema.gearItems).set({ isLocked: locked }).where(and(eq(schema.gearItems.id, gearId), eq(schema.gearItems.ownerId, player.id)));
    return { success: true };
  });

  app.get('/api/gear/loadouts', async (req, reply) => {
    const player = await requireAuth(req, reply);
    return buildLoadouts(player.id);
  });

  app.put('/api/gear/loadouts/:slot', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const slot = String((req.params as any).slot);
    if (!LOADOUT_SLOTS.includes(Number(slot) as 1 | 2 | 3 | 4)) throw new AppError('INVALID_LOADOUT_SLOT', '配装槽位不存在。');
    const name = z.string().trim().min(1).max(24).parse((req.body as any)?.name);
    const [equipped, saved] = await Promise.all([
      db.select().from(schema.gearItems).where(and(eq(schema.gearItems.ownerId, player.id), eq(schema.gearItems.isEquipped, true))),
      loadLoadoutState(player.id),
    ]);
    const mapped = mapEquippedGear(equipped);
    saved[slot] = { name, gearIds: (mapped[slot] ?? []).map((item) => item.id) };
    await saveLoadoutState(player.id, saved);
    return { ...(await buildLoadouts(player.id)), serverTime: new Date().toISOString() };
  });

  app.delete('/api/gear/loadouts/:slot', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const slot = String((req.params as any).slot);
    const saved = await loadLoadoutState(player.id);
    delete saved[slot];
    await saveLoadoutState(player.id, saved);
    return { ...(await buildLoadouts(player.id)), serverTime: new Date().toISOString() };
  });

  app.post('/api/gear/loadouts/:slot/load', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const slot = String((req.params as any).slot);
    const saved = await loadLoadoutState(player.id);
    const entry = saved[slot];
    if (!entry) throw new AppError('LOADOUT_NOT_FOUND', '该配装尚未保存。');
    const ids = entry.gearIds ?? [];
    await db.transaction(async (tx) => {
      await tx.update(schema.gearItems).set({ isEquipped: false, updatedAt: new Date() }).where(eq(schema.gearItems.ownerId, player.id));
      for (const id of ids) {
        const item = (await tx.select().from(schema.gearItems).where(and(eq(schema.gearItems.id, id), eq(schema.gearItems.ownerId, player.id))))[0];
        if (!item || item.isMarketListed || item.isLocked) continue;
        await tx.update(schema.gearItems).set({ isEquipped: true, updatedAt: new Date() }).where(eq(schema.gearItems.id, id));
      }
    });
    return { ...(await buildLoadouts(player.id)), serverTime: new Date().toISOString() };
  });

  app.post('/api/gear/:gearId/equip', async (req, reply) => { const player = await requireAuth(req, reply); return equipGear(player.id, String((req.params as any).gearId)); });
  app.post('/api/gear/:gearId/unequip', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const gearId = String((req.params as any).gearId);
    const gear = (await db.select().from(schema.gearItems).where(and(eq(schema.gearItems.id, gearId), eq(schema.gearItems.ownerId, player.id))))[0];
    if (!gear) throw new AppError('GEAR_NOT_FOUND', '装备不存在。');
    await db.update(schema.gearItems).set({ isEquipped: false, updatedAt: new Date() }).where(eq(schema.gearItems.id, gear.id));
    return { gear: gearPublic({ ...gear, isEquipped: false }), player: await fullPlayer(player.id), serverTime: new Date().toISOString() };
  });
  app.patch('/api/gear/:gearId/lock', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const gearId = String((req.params as any).gearId);
    const isLocked = Boolean((req.body as any)?.isLocked);
    await db.update(schema.gearItems).set({ isLocked, updatedAt: new Date() }).where(and(eq(schema.gearItems.id, gearId), eq(schema.gearItems.ownerId, player.id)));
    return { success: true, isLocked };
  });
  app.post('/api/gear/:gearId/upgrade', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const gearId = String((req.params as any).gearId);
    const gear = (await db.select().from(schema.gearItems).where(and(eq(schema.gearItems.id, gearId), eq(schema.gearItems.ownerId, player.id))))[0];
    if (!gear) throw new AppError('GEAR_NOT_FOUND', '装备不存在。');
    const cost = upgradeCost(gear);
    if (player.gold < cost.gold) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    const success = Math.random() < 0.8;
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${cost.gold}` }).where(eq(schema.players.id, player.id));
      if (success) await tx.update(schema.gearItems).set({ upgradeLevel: gear.upgradeLevel + 1, updatedAt: new Date() }).where(eq(schema.gearItems.id, gear.id));
    });
    const updated = (await db.select().from(schema.gearItems).where(eq(schema.gearItems.id, gear.id)))[0];
    return { gear: gearPublic(updated), success, player: await fullPlayer(player.id), serverTime: new Date().toISOString() };
  });
  app.post('/api/inventory/gear/dismantle', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({ gearIds: z.array(z.string().uuid()).min(1).max(100) }).parse(req.body as any);
    let relicsGained = 0;
    let dismantledCount = 0;
    await db.transaction(async (tx) => {
      for (const id of body.gearIds) {
        const gear = (await tx.select().from(schema.gearItems).where(and(eq(schema.gearItems.id, id), eq(schema.gearItems.ownerId, player.id))))[0];
        if (!gear || gear.isEquipped || gear.isLocked || gear.isMarketListed) continue;
        relicsGained += salvageRelics(gear);
        dismantledCount += 1;
        await tx.delete(schema.gearItems).where(eq(schema.gearItems.id, gear.id));
      }
      if (relicsGained) await tx.update(schema.players).set({ relics: sql`${schema.players.relics} + ${relicsGained}` }).where(eq(schema.players.id, player.id));
    });
    return { relicsGained, dismantledCount, player: await fullPlayer(player.id), serverTime: new Date().toISOString() };
  });

  app.post('/api/chests/:chestId/open', async (req, reply) => { const player = await requireAuth(req, reply); return openChestAlias(player, String((req.params as any).chestId), req); });
  app.post('/api/chests/:chestId/purchase', async (req, reply) => { const player = await requireAuth(req, reply); return purchaseChestAlias(player, String((req.params as any).chestId), req); });
}

export async function openChest(tx: any, playerId: string, def: typeof schema.chests.$inferSelect, forcedRarity?: string): Promise<any> {
  const chances = def.rarityChances as Array<{ rarity: string; chancePermille: number }>;
  if (!chances.length) throw new AppError('CHEST_CONFIG_INVALID', '宝箱掉落配置无效。', 500);
  const total = chances.reduce((sum, entry) => sum + entry.chancePermille, 0);
  let roll = Math.floor(Math.random() * total);
  let rarity = forcedRarity ?? chances[0].rarity;
  if (!forcedRarity) {
    for (const entry of chances) {
      if (roll < entry.chancePermille) { rarity = entry.rarity; break; }
      roll -= entry.chancePermille;
    }
  }

  const templates = await tx.select().from(schema.gearTemplates).where(sql`${schema.gearTemplates.minRarityIndex} <= ${RARITY_ORDER.indexOf(rarity as any)} AND ${schema.gearTemplates.maxRarityIndex} >= ${RARITY_ORDER.indexOf(rarity as any)}`);
  const template = templates[Math.floor(Math.random() * templates.length)] ?? (await tx.select().from(schema.gearTemplates))[0];
  if (!template) throw new AppError('GEAR_TEMPLATE_MISSING', '装备模板不存在。', 500);

  const rarityIndex = RARITY_ORDER.indexOf(rarity as any);
  const quality = Math.min(100, Math.max(1, Math.round(1 + (rarityIndex / 8) * 60 + Math.random() * 39)));
  const baseStats = rollStats(template.baseStatRange, quality, rarityIndex);

  const gear = (await tx.insert(schema.gearItems).values({
    ownerId: playerId,
    templateId: template.id,
    name: template.name,
    slot: template.slot,
    rarity,
    quality,
    qualityStars: Math.min(5, Math.max(1, Math.round(quality / 20))),
    baseStats,
    upgradeLevel: 0,
    sourceBiomeId: null,
  }).returning())[0];
  return gearPublic(gear);
}

export function rollStats(range: Record<string, [number, number]>, quality: number, rarityIndex = 0): Record<string, number> {
  const out: Record<string, number> = {};
  const qualityMult = 1 + quality / 200;
  const rarityMult = 1 + rarityIndex * 0.15;
  for (const [k, [min, max]] of Object.entries(range)) {
    out[k] = Math.max(0, Math.round((min + Math.random() * (max - min)) * qualityMult * rarityMult));
  }
  return out;
}

export function gearValue(g: typeof schema.gearItems.$inferSelect): number {
  const rarityBase: Record<string, number> = { common: 500, uncommon: 2000, fine: 8000, rare: 30000, epic: 120000, legendary: 500000, mythic: 2000000, exotic: 8000000, arcane: 50000000 };
  const base = rarityBase[g.rarity] ?? 500;
  const statTotal = Object.values(g.baseStats ?? {}).reduce((s, v) => s + v, 0);
  return Math.floor(base * (0.5 + statTotal / 100) * (1 + g.upgradeLevel * 0.3));
}

export function upgradeCost(g: typeof schema.gearItems.$inferSelect): { gold: number; relics: number } {
  const level = g.upgradeLevel + 1;
  return {
    gold: Math.floor(1000 * Math.pow(1.6, level)),
    relics: Math.floor(10 * Math.pow(1.4, level)),
  };
}

export function rerollCost(g: typeof schema.gearItems.$inferSelect): number {
  const rarityBase: Record<string, number> = { common: 50, uncommon: 100, fine: 200, rare: 400, epic: 800, legendary: 1600, mythic: 3200, exotic: 6400, arcane: 12800 };
  return (rarityBase[g.rarity] ?? 50) * (1 + g.upgradeLevel);
}

export function salvageRelics(g: typeof schema.gearItems.$inferSelect): number {
  const rarityBase: Record<string, number> = { common: 5, uncommon: 10, fine: 20, rare: 40, epic: 80, legendary: 160, mythic: 320, exotic: 640, arcane: 1280 };
  return Math.floor((rarityBase[g.rarity] ?? 5) * (1 + g.upgradeLevel * 0.5));
}

const INVENTORY_ITEMS = [
  { itemId: 'furnace_carbon', name: '炉岩碳', description: '用于魔法石升阶与单槽重随。永烬炉海与回环岁海的神器掉落事件分别产出 10 / 12 份，可在道具市场交易。', definitionVersion: 'v2', imagePath: '/items/furnace-carbon.webp', category: 'material', marketSellerFeeBasisPoints: 1500, openReward: null },
  { itemId: 'legendary_gear_crystal', name: '传说结晶', description: '分解同档装备获得，用于装备破限与魔法石培养，可在道具市场交易。', definitionVersion: 'v1', imagePath: '/items/legendary-gear-crystal.webp', category: 'material', marketSellerFeeBasisPoints: 1500, openReward: null },
  { itemId: 'mythic_gear_crystal', name: '神话结晶', description: '分解同档装备获得，用于装备破限与魔法石培养，可在道具市场交易。', definitionVersion: 'v1', imagePath: '/items/mythic-gear-crystal.webp', category: 'material', marketSellerFeeBasisPoints: 1500, openReward: null },
  { itemId: 'exotic_gear_crystal', name: '奇异结晶', description: '分解同档装备获得，用于装备破限与魔法石培养，可在道具市场交易。', definitionVersion: 'v1', imagePath: '/items/exotic-gear-crystal.webp', category: 'material', marketSellerFeeBasisPoints: 1500, openReward: null },
  { itemId: 'relic_fragment_gift_box', name: '遗物碎片礼盒', description: '开启后固定获得 800 遗物和 80 奥秘碎片。', definitionVersion: 'v2', imagePath: '/items/relic-fragment-gift-box.webp', category: 'consumable', marketSellerFeeBasisPoints: 1800, openReward: { relics: 800, fragments: 80 } },
];

async function loadItemCounts(playerId: string): Promise<Record<string, number>> {
  const row = (await db.select().from(schema.globalSettings).where(eq(schema.globalSettings.key, `player-items:${playerId}`)))[0];
  return row?.value && typeof row.value === 'object' ? row.value as Record<string, number> : {};
}

async function saveItemCounts(playerId: string, value: Record<string, number>) {
  const key = `player-items:${playerId}`;
  await db.insert(schema.globalSettings).values({ key, value }).onConflictDoUpdate({ target: schema.globalSettings.key, set: { value, updatedAt: new Date() } });
}

const LOADOUT_SLOTS = [1, 2, 3, 4] as const;
type SavedLoadout = { name: string; gearIds: string[] };
type LoadoutState = Record<string, SavedLoadout>;

async function loadLoadoutState(playerId: string): Promise<LoadoutState> {
  const row = (await db.select().from(schema.globalSettings).where(eq(schema.globalSettings.key, `gear-loadouts:${playerId}`)))[0];
  return row?.value && typeof row.value === 'object' ? row.value as LoadoutState : {};
}

async function saveLoadoutState(playerId: string, state: LoadoutState) {
  await db.insert(schema.globalSettings).values({ key: `gear-loadouts:${playerId}`, value: state })
    .onConflictDoUpdate({ target: schema.globalSettings.key, set: { value: state, updatedAt: new Date() } });
}

function mapEquippedGear(items: (typeof schema.gearItems.$inferSelect)[]) {
  const mapped: Record<string, typeof schema.gearItems.$inferSelect[]> = {};
  let ringIndex = 0;
  for (const item of [...items].sort((a, b) => a.acquiredAt.getTime() - b.acquiredAt.getTime())) {
    const slot = item.slot === 'ring' ? (ringIndex++ === 0 ? 'ring_1' : 'ring_2') : item.slot;
    (mapped[slot] ??= []).push(item);
  }
  return mapped;
}

function loadoutStats(items: (typeof schema.gearItems.$inferSelect)[]) {
  const stats = { strength: 0, intelligence: 0, luck: 0, endurance: 0 };
  for (const item of items) {
    const pub = gearPublic(item);
    for (const stat of Object.keys(stats) as Array<keyof typeof stats>) stats[stat] += Number(pub.effectiveStats[stat] ?? 0);
  }
  return stats;
}

async function buildLoadouts(playerId: string) {
  const [saved, equipped, owned, player] = await Promise.all([
    loadLoadoutState(playerId),
    db.select().from(schema.gearItems).where(and(eq(schema.gearItems.ownerId, playerId), eq(schema.gearItems.isEquipped, true))),
    db.select().from(schema.gearItems).where(eq(schema.gearItems.ownerId, playerId)),
    db.select().from(schema.players).where(eq(schema.players.id, playerId)),
  ]);
  const current = mapEquippedGear(equipped);
  const ownedMap = new Map(owned.map((item) => [item.id, item]));
  const loadouts = LOADOUT_SLOTS.map((slot) => {
    const entry = saved[String(slot)];
    const source = entry ? entry.gearIds.map((id) => ownedMap.get(id)).filter(Boolean) as (typeof schema.gearItems.$inferSelect)[] : equipped;
    const sourceBySlot = entry ? mapEquippedGear(source) : current;
    const gear: Record<string, any> = {};
    for (const [gearSlot, items] of Object.entries(sourceBySlot)) {
      const item = items[0];
      if (item) gear[gearSlot] = { ...gearPublic(item), specialAffixes: [] };
    }
    return {
      slot,
      name: entry?.name ?? null,
      gear,
      stats: loadoutStats(source),
      missingSlots: entry ? Object.entries(sourceBySlot).length === 0 ? [] : [] : [],
    };
  });
  const totalStats = loadoutStats(equipped);
  return {
    loadouts,
    totalStats,
    relics: player[0]?.relics ?? 0,
    gold: player[0]?.gold ?? 0,
  };
}

async function equipGear(playerId: string, gearId: string) {
  const gear = (await db.select().from(schema.gearItems).where(and(eq(schema.gearItems.id, gearId), eq(schema.gearItems.ownerId, playerId))))[0];
  if (!gear) throw new AppError('GEAR_NOT_FOUND', '装备不存在。');
  if (gear.isMarketListed || gear.isLocked) throw new AppError('GEAR_UNAVAILABLE', '该装备当前无法穿戴。');
  await db.transaction(async (tx) => {
    if (gear.slot === 'ring') {
      const rings = await tx.select().from(schema.gearItems).where(and(eq(schema.gearItems.ownerId, playerId), eq(schema.gearItems.slot, 'ring'), eq(schema.gearItems.isEquipped, true)));
      if (rings.length >= 2) {
        const oldest = rings.sort((a, b) => a.acquiredAt.getTime() - b.acquiredAt.getTime())[0];
        await tx.update(schema.gearItems).set({ isEquipped: false }).where(eq(schema.gearItems.id, oldest.id));
      }
    } else {
      await tx.update(schema.gearItems).set({ isEquipped: false }).where(and(eq(schema.gearItems.ownerId, playerId), eq(schema.gearItems.slot, gear.slot), eq(schema.gearItems.isEquipped, true)));
    }
    await tx.update(schema.gearItems).set({ isEquipped: true, updatedAt: new Date() }).where(eq(schema.gearItems.id, gear.id));
  });
  const updated = (await db.select().from(schema.gearItems).where(eq(schema.gearItems.id, gear.id)))[0];
  return { gear: gearPublic(updated), player: await fullPlayer(playerId), serverTime: new Date().toISOString() };
}

async function openChestAlias(player: any, chestId: string, req: any) {
  const body = z.object({ quantity: z.number().int().min(1).max(100).default(1) }).parse(req.body ?? {});
  const quantity = body.quantity;
  const [def, pc] = await Promise.all([
    db.select().from(schema.chests).where(eq(schema.chests.id, chestId)),
    db.select().from(schema.playerChests).where(and(eq(schema.playerChests.playerId, player.id), eq(schema.playerChests.chestId, chestId))),
  ]);
  if (!def[0]) throw new AppError('CHEST_NOT_FOUND', '宝箱不存在。');
  if ((pc[0]?.quantity ?? 0) < quantity) throw new AppError('INSUFFICIENT_CHESTS', '宝箱数量不足。');

  const opened: any[] = [];
  let nextArcaneDry = pc[0]?.arcaneChestsSinceArcaneGear ?? 0;
  await db.transaction(async (tx) => {
    await tx.update(schema.playerChests)
      .set({
        quantity: sql`${schema.playerChests.quantity} - ${quantity}`,
        openedCount: sql`${schema.playerChests.openedCount} + ${quantity}`,
      })
      .where(and(eq(schema.playerChests.playerId, player.id), eq(schema.playerChests.chestId, chestId)));

    for (let index = 0; index < quantity; index += 1) {
      const forceArcane = chestId === 'arcane_gear_chest' && nextArcaneDry + 1 >= ARCANE_CHEST_HARD_PITY;
      const gear = await openChest(tx, player.id, def[0], forceArcane ? 'arcane' : undefined);
      opened.push(gear);
      if (chestId === 'arcane_gear_chest') nextArcaneDry = gear.rarity === 'arcane' ? 0 : nextArcaneDry + 1;
    }

    if (chestId === 'arcane_gear_chest') {
      await tx.update(schema.playerChests)
        .set({ arcaneChestsSinceArcaneGear: nextArcaneDry })
        .where(and(eq(schema.playerChests.playerId, player.id), eq(schema.playerChests.chestId, chestId)));
    }
    await tx.update(schema.players)
      .set({ totalChestsOpened: sql`${schema.players.totalChestsOpened} + ${quantity}` })
      .where(eq(schema.players.id, player.id));
  });

  const chest = await chestById(player.id, chestId);
  return {
    gear: opened,
    quantityOpened: quantity,
    chest,
    pity: chest?.pity ?? null,
    materials: [],
    player: await fullPlayer(player.id),
    serverTime: new Date().toISOString(),
  };
}

async function purchaseChestAlias(player: any, chestId: string, req: any) {
  const body = z.object({
    quantity: z.number().int().min(1).max(1000).default(1),
    paymentCurrency: z.enum(['gold', 'relic', 'fragment']),
  }).parse(req.body ?? {});
  const quantity = body.quantity;
  const currency = body.paymentCurrency;
  const def = (await db.select().from(schema.chests).where(eq(schema.chests.id, chestId)))[0];
  if (!def) throw new AppError('CHEST_NOT_FOUND', '宝箱不存在。');
  const option = def.paymentOptions?.find((entry: any) => entry.currency === currency);
  if (!option) throw new AppError('INVALID_CURRENCY', '该宝箱不支持此货币。');
  const cost = Number(option.unitPrice) * quantity;
  const today = chinaDate();
  const pc = (await db.select().from(schema.playerChests).where(and(eq(schema.playerChests.playerId, player.id), eq(schema.playerChests.chestId, chestId))))[0];
  if (option.dailyLimit) {
    const todayCount = pc?.lastPurchaseDate === today ? pc.purchasedToday ?? 0 : 0;
    if (todayCount + quantity > option.dailyLimit) throw new AppError('DAILY_LIMIT', '今日购买次数已达上限。');
  }

  await db.transaction(async (tx) => {
    const current = (await tx.select().from(schema.players).where(eq(schema.players.id, player.id)))[0];
    if (currency === 'gold' && current.gold < cost) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    if (currency === 'relic' && current.relics < cost) throw new AppError('INSUFFICIENT_RELICS', '遗物不足。');
    if (currency === 'fragment' && current.fragments < cost) throw new AppError('INSUFFICIENT_FRAGMENTS', '奥秘碎片不足。');
    if (!['gold', 'relic', 'fragment'].includes(currency)) throw new AppError('INVALID_CURRENCY', '不支持的支付货币。');

    const column = currency === 'gold' ? schema.players.gold : currency === 'relic' ? schema.players.relics : schema.players.fragments;
    await tx.update(schema.players)
      .set(currency === 'gold' ? { gold: sql`${column} - ${cost}` } : currency === 'relic' ? { relics: sql`${column} - ${cost}` } : { fragments: sql`${column} - ${cost}` })
      .where(eq(schema.players.id, player.id));
    await tx.insert(schema.playerChests).values({
      playerId: player.id,
      chestId,
      quantity,
      lastPurchaseDate: today,
      purchasedToday: quantity,
    }).onConflictDoUpdate({
      target: [schema.playerChests.playerId, schema.playerChests.chestId],
      set: {
        quantity: sql`${schema.playerChests.quantity} + ${quantity}`,
        lastPurchaseDate: today,
        purchasedToday: option.dailyLimit
          ? sql`CASE WHEN ${schema.playerChests.lastPurchaseDate} = ${today} THEN ${schema.playerChests.purchasedToday} + ${quantity} ELSE ${quantity} END`
          : schema.playerChests.purchasedToday,
      },
    });
  });

  const chest = await chestById(player.id, chestId);
  return {
    chest,
    player: await fullPlayer(player.id),
    serverTime: new Date().toISOString(),
  };
}

export function gearPublic(g: any) {
  const statsAtLevel = (level: number) => {
    const stats: Record<string, number> = {};
    for (const key of ['strength', 'intelligence', 'luck', 'endurance']) {
      stats[key] = (g.baseStats?.[key] ?? 0) + Math.round((g.baseStats?.[key] ?? 0) * level * 0.1);
    }
    return stats;
  };
  const baseStats: Record<string, number> = {};
  for (const key of ['strength', 'intelligence', 'luck', 'endurance']) baseStats[key] = g.baseStats?.[key] ?? 0;
  const effectiveStats = statsAtLevel(g.upgradeLevel ?? 0);
  const nextUpgradeStats = (g.upgradeLevel ?? 0) < 10 ? statsAtLevel((g.upgradeLevel ?? 0) + 1) : null;
  return {
    id: g.id,
    templateId: g.templateId,
    name: g.name,
    sourceBiomeId: g.sourceBiomeId,
    rarity: g.rarity,
    quality: g.quality,
    slot: g.slot,
    equippedSlot: g.isEquipped ? (g.slot === 'ring' ? 'ring_1' : g.slot) : null,
    isLocked: g.isLocked,
    upgradeLevel: g.upgradeLevel,
    limitBreakPercent: 0,
    qualityStars: g.qualityStars,
    baseStats,
    effectiveStats,
    nextUpgradeStats,
    nextLimitBreakStats: null,
    stats: effectiveStats,
    upgradeCost: (g.upgradeLevel ?? 0) < 10 ? upgradeCost(g).gold : null,
    limitBreakCost: null,
    reforgeCost: rerollCost(g),
    slotRerollCost: g.slot === 'magic_stone' ? null : rerollCost(g),
    specialAffixes: [],
    sellValue: gearValue(g),
    generationVersion: g.generationVersion,
    contentVersion: g.contentVersion,
    acquiredAt: g.acquiredAt?.toISOString() ?? null,
    marketOrderId: g.isMarketListed ? g.id : null,
  };
}

async function fishInventory(playerId: string) {
  const [rows, fishDefs, settingsRow] = await Promise.all([
    db.select().from(schema.playerInventoryFish).where(eq(schema.playerInventoryFish.playerId, playerId)),
    db.select().from(schema.fish),
    db.select().from(schema.globalSettings).where(eq(schema.globalSettings.key, `fish-inventory-settings:${playerId}`)),
  ]);
  const defMap = new Map(fishDefs.map((fish) => [fish.id, fish]));
  const fish = rows
    .filter((row) => row.quantity > 0 || row.totalCaught > 0)
    .map((row) => {
      const def = defMap.get(row.fishId);
      const sellPrice = def?.sellPrice ?? 0;
      return {
        fishId: row.fishId,
        biomeId: def?.biomeId ?? null,
        name: def?.name ?? row.fishId,
        description: def?.description ?? '',
        rarity: def?.rarity ?? 'common',
        imagePath: def?.imagePath ?? '',
        quantity: row.quantity,
        totalCaught: row.totalCaught,
        sellPrice,
        totalSellValue: sellPrice * row.quantity,
        titanValueSummary: null,
        isLocked: row.isLocked,
        isManuallyLocked: row.isLocked,
        isMasteryLocked: false,
      };
    })
    .sort((a, b) => RARITY_ORDER.indexOf(a.rarity as any) - RARITY_ORDER.indexOf(b.rarity as any));
  const configured = settingsRow[0]?.value as { autoLockMasteryFish?: boolean } | undefined;
  return { fish, settings: { autoLockMasteryFish: configured?.autoLockMasteryFish === true } };
}

async function chestList(playerId: string) {
  const [chestDefs, playerChests] = await Promise.all([
    db.select().from(schema.chests).orderBy(schema.chests.orderIndex),
    db.select().from(schema.playerChests).where(eq(schema.playerChests.playerId, playerId)),
  ]);
  const ownedMap = new Map(playerChests.map((chest) => [chest.chestId, chest]));
  const today = chinaDate();
  return {
    chests: chestDefs.map((def) => {
      const owned = ownedMap.get(def.id);
      const hasDailyLimit = def.paymentOptions?.some((option: any) => option.dailyLimit);
      const purchasedToday = owned?.lastPurchaseDate === today ? owned.purchasedToday ?? 0 : 0;
      return {
        chestId: def.id,
        name: def.name,
        quantity: owned?.quantity ?? 0,
        price: def.price,
        pity: def.id === 'arcane_gear_chest'
          ? {
              currentDryOpens: owned?.arcaneChestsSinceArcaneGear ?? 0,
              hardPityOpens: ARCANE_CHEST_HARD_PITY,
              remainingOpens: Math.max(0, ARCANE_CHEST_HARD_PITY - (owned?.arcaneChestsSinceArcaneGear ?? 0)),
            }
          : null,
        paymentOptions: def.paymentOptions.map((option: any) => ({
          ...option,
          purchasedToday: hasDailyLimit ? purchasedToday : 0,
          remainingToday: option.dailyLimit === null || option.dailyLimit === undefined
            ? null
            : Math.max(0, option.dailyLimit - purchasedToday),
        })),
        purchaseLimitResetAt: hasDailyLimit ? nextChinaMidnightIso() : null,
        rarityChances: def.rarityChances,
      };
    }),
  };
}

async function chestById(playerId: string, chestId: string) {
  return (await chestList(playerId)).chests.find((chest) => chest.chestId === chestId) ?? null;
}

function nextChinaMidnightIso() {
  const chinaNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const nextUtc = Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), chinaNow.getUTCDate() + 1) - 8 * 60 * 60 * 1000;
  return new Date(nextUtc).toISOString();
}

async function playerRow(playerId: string) {
  return (await db.select().from(schema.players).where(eq(schema.players.id, playerId)))[0];
}

async function fullPlayer(playerId: string) {
  const session = await buildSession(await playerRow(playerId));
  return session.player;
}

function chinaDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const china = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return `${china.getUTCFullYear()}-${p(china.getUTCMonth() + 1)}-${p(china.getUTCDate())}`;
}
