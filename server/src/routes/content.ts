import { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { requireAuth, requireAuthOrNull } from '../services/auth.js';
import { buildSession } from './auth.js';
import { AppError } from '../util/errors.js';
import { RARITIES, RARITY_ORDER, GEAR_SLOTS } from '../constants.js';
import { loadPlayerContext } from '../services/playerState.js';
import { getWeatherForBiome, nextCycleStart } from '../services/weather.js';
import { publicSiteConfig } from '../services/siteConfig.js';

export async function registerContentRoutes(app: FastifyInstance) {
  app.get('/api/avatars/:avatarId/image', async (req, reply) => {
    const avatarId = String((req.params as any).avatarId);
    if (/^(?:13000000|14000000)-/.test(avatarId)) return reply.redirect(`/avatars/${avatarId}.webp`);
    const themes: Record<string, { a: string; b: string; c: string; mark: string }> = {
      '13000000-0000-4000-8000-000000000001': { a: '#d8f1f4', b: '#3c8da0', c: '#efd084', mark: '月' },
      '13000000-0000-4000-8000-000000000002': { a: '#c8e3e7', b: '#274f69', c: '#80d9d5', mark: '潮' },
      '13000000-0000-4000-8000-000000000003': { a: '#f7d0ba', b: '#a94c42', c: '#efb74f', mark: '烬' },
      '13000000-0000-4000-8000-000000000004': { a: '#d8cff2', b: '#514785', c: '#9ce1d8', mark: '星' },
      '13000000-0000-4000-8000-000000000005': { a: '#f4e2a9', b: '#6e4a8d', c: '#62d3cb', mark: '奥' },
    };
    const theme = themes[avatarId] ?? { a: '#d8eef0', b: '#2c7d88', c: '#efbd4e', mark: '鱼' };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${theme.a}"/><stop offset="1" stop-color="${theme.b}"/></linearGradient></defs>
      <rect width="256" height="256" rx="128" fill="url(#g)"/>
      <circle cx="128" cy="128" r="98" fill="none" stroke="${theme.c}" stroke-opacity=".55" stroke-width="3"/>
      <path d="M58 135c25-32 51-42 83-37 22 4 39 17 58 34-19 17-39 28-62 31-30 4-55-8-79-28Z" fill="#fff" fill-opacity=".72" stroke="${theme.b}" stroke-width="3"/>
      <path d="M139 98l21-25 4 30M139 173l21 24 5-31" fill="${theme.c}" fill-opacity=".85"/>
      <circle cx="94" cy="124" r="5" fill="${theme.b}"/><path d="M86 140c10 8 22 11 35 9" fill="none" stroke="${theme.c}" stroke-width="4" stroke-linecap="round"/>
      <text x="128" y="224" text-anchor="middle" font-family="serif" font-size="22" fill="${theme.b}" opacity=".85">${theme.mark}</text>
    </svg>`;
    return reply.type('image/svg+xml').header('Cache-Control', 'public, max-age=604800').send(svg);
  });

  app.get('/api/site-config', async () => publicSiteConfig());

  app.get('/api/announcements', async () => {
    const rows = await db.select().from(schema.announcements).where(and(
      eq(schema.announcements.isActive, true),
      sql`(${schema.announcements.expiresAt} IS NULL OR ${schema.announcements.expiresAt} > now())`,
    )).orderBy(sql`${schema.announcements.createdAt} DESC`).limit(10);
    return { items: rows };
  });

  app.get('/api/content/bootstrap', async (req, reply) => {
    await requireAuthOrNull(req, reply);
    const [meta, biomes, fish, avatars, baits, rods, weather] = await Promise.all([
      db.select().from(schema.contentMeta),
      db.select().from(schema.biomes).orderBy(schema.biomes.orderIndex),
      db.select().from(schema.fish),
      db.select().from(schema.avatars).where(eq(schema.avatars.source, 'base')).orderBy(schema.avatars.orderIndex),
      db.select().from(schema.baits).orderBy(schema.baits.orderIndex),
      db.select().from(schema.rods).orderBy(schema.rods.orderIndex),
      db.select().from(schema.weather).orderBy(schema.weather.orderIndex),
    ]);

    return {
      contentVersion: meta[0]?.contentVersion ?? '2026.22',
      statResetCost: { currency: 'gold', amount: meta[0]?.statResetCostGold ?? 10000 },
      rarities: RARITIES,
      biomes: biomes.map((b) => ({
        id: b.id, name: b.name, theme: b.theme,
        requiredLevel: b.requiredLevel, unlockCost: b.unlockCost, valueMultiplier: b.valueMultiplier,
      })),
      fish: fish.map((f) => ({
        id: f.id, name: f.name, description: f.description, category: '鱼类',
        biomeId: f.biomeId, rarity: f.rarity, sellPrice: f.sellPrice, imagePath: f.imagePath,
      })),
      avatars: avatars.map((a) => ({ id: a.id, name: a.name, imagePath: a.imagePath, isActive: a.isActive })),
      baits: baits.map((b) => ({
        id: b.id, tier: b.tier, name: b.name, unitPrice: b.unitPrice, luck: b.luck,
        minRarity: b.minRarityIndex, maxRarity: b.maxRarityIndex,
        fishRarityMultipliers: b.fishRarityMultipliers ?? {},
        allowsRelic: b.allowsRelic, allowsGear: b.allowsGear, allowsChest: b.allowsChest, isUnlimited: b.isUnlimited,
      })),
      rods: rods.map((r) => ({
        id: r.id, name: r.name, description: r.description, requiredLevel: r.requiredLevel,
        purchaseCost: r.purchaseCost, baseUpgradeCost: r.baseUpgradeCost, upgradeCostGrowth: r.upgradeCostGrowth,
        maxLevel: r.maxLevel, statPerLevel: r.statPerLevel ?? {}, specialEffect: r.specialEffect ?? null,
      })),
      weather: weather.map((w) => ({
        id: w.id, name: w.name, effect: w.effect, refreshWeight: w.refreshWeight,
        xpMultiplier: w.xpMultiplier, quantityBonus: w.quantityBonus,
        gearCategoryMultiplier: w.gearCategoryMultiplier, relicCategoryMultiplier: w.relicCategoryMultiplier,
        rarityMultipliers: w.rarityMultipliers ?? {}, directGoldRangeBonus: w.directGoldRangeBonus ?? null,
        excludedBiomeIds: w.excludedBiomeIds ?? [], rarityDisplayPercentages: w.rarityDisplayPercentages ?? {},
      })),
      gearSlots: GEAR_SLOTS,
      equippedGearSlots: ['head', 'chest', 'legs', 'boots', 'gloves', 'ring_1', 'ring_2', 'amulet', 'charm'],
      serverTime: new Date().toISOString(),
    };
  });

  app.get('/api/biomes', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const [biomes, playerBiomes, activeTournaments] = await Promise.all([
      db.select().from(schema.biomes).orderBy(schema.biomes.orderIndex),
      db.select().from(schema.playerBiomes).where(eq(schema.playerBiomes.playerId, player.id)),
      db.select().from(schema.tournaments).where(eq(schema.tournaments.status, 'active')),
    ]);

    const globalRuns = await db.select({
      biomeId: schema.fishingRuns.biomeId,
      mode: schema.fishingRuns.mode,
      count: sql<number>`count(*)::int`,
    }).from(schema.fishingRuns).where(eq(schema.fishingRuns.status, 'running')).groupBy(schema.fishingRuns.biomeId, schema.fishingRuns.mode);
    const counts = new Map<string, { total: number; online: number; offline: number }>();
    for (const r of globalRuns) {
      const entry = counts.get(r.biomeId) ?? { total: 0, online: 0, offline: 0 };
      entry.total += r.count;
      if (r.mode === 'offline') entry.offline += r.count;
      else entry.online += r.count;
      counts.set(r.biomeId, entry);
    }

    const out = [];
    for (const b of biomes) {
      const unlocked = playerBiomes.find((pb) => pb.biomeId === b.id)?.isUnlocked ?? false;
      const { weather } = await getWeatherForBiome(b.id);
      const activeComp = activeTournaments.filter((t) => t.biomeId === b.id);
      out.push({
        id: b.id,
        name: b.name,
        requiredLevel: b.requiredLevel,
        unlockCost: b.unlockCost,
        valueMultiplier: b.valueMultiplier,
        gold: [b.directGoldMin, b.directGoldMax],
        theme: b.theme,
        isUnlocked: unlocked,
        isCurrent: player.currentBiomeId === b.id,
        activeCompetitions: activeComp.map((t) => ({ type: t.type, sequence: t.sequence, endAt: t.endAt.toISOString() })),
        fishingCount: counts.get(b.id) ?? { total: 0, online: 0, offline: 0 },
        masteryXpBonusBasisPoints: 0,
        guildXpBonusBasisPoints: 0,
        guildBoostEndsAt: null,
        weather: {
          biomeId: b.id,
          weatherId: weather.id,
          name: weather.name,
          effect: weather.effect,
          startedAt: cycleStarted(weather.id, b.id).toISOString(),
          endsAt: nextCycleStart().toISOString(),
        },
      });
    }
    return { biomes: out, nextRefreshAt: nextCycleStart().toISOString(), serverTime: new Date().toISOString() };
  });

  app.post('/api/biomes/:biomeId/unlock', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const biomeId = String((req.params as any).biomeId);
    const biome = (await db.select().from(schema.biomes).where(eq(schema.biomes.id, biomeId)))[0];
    if (!biome) throw new AppError('BIOME_NOT_FOUND', '地图不存在。');
    if (player.level < biome.requiredLevel) throw new AppError('LEVEL_REQUIREMENT', `需要等级 ${biome.requiredLevel} 才能解锁该地图。`);
    if (player.gold < biome.unlockCost) throw new AppError('INSUFFICIENT_GOLD', '金币不足，无法解锁该地图。');

    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: player.gold - biome.unlockCost }).where(eq(schema.players.id, player.id));
      await tx.insert(schema.playerBiomes).values({
        playerId: player.id, biomeId: biome.id, isUnlocked: true, unlockedAt: new Date(),
      }).onConflictDoUpdate({ target: [schema.playerBiomes.playerId, schema.playerBiomes.biomeId], set: { isUnlocked: true } });
    });
    const updated = (await db.select().from(schema.players).where(eq(schema.players.id, player.id)))[0];
    const session = await buildSession(updated);
    return { player: session.player, publicIdentity: session.publicIdentity, biomeId, serverTime: session.serverTime };
  });

  const switchPersonalBiome = async (req: any, reply: any) => {
    const player = await requireAuth(req, reply);
    const body = { biomeId: String((req.body as any)?.biomeId ?? '') };
    const biome = (await db.select().from(schema.biomes).where(eq(schema.biomes.id, body.biomeId)))[0];
    if (!biome) throw new AppError('BIOME_NOT_FOUND', '地图不存在。');
    const unlocked = (await db.select().from(schema.playerBiomes).where(and(
      eq(schema.playerBiomes.playerId, player.id), eq(schema.playerBiomes.biomeId, body.biomeId),
    )))[0];
    if (!unlocked?.isUnlocked) throw new AppError('BIOME_LOCKED', '该地图尚未解锁。');
    await db.transaction(async (tx) => {
      await tx.update(schema.fishingRuns)
        .set({ status: 'completed', endedAt: new Date(), endReason: 'biome_changed' })
        .where(and(eq(schema.fishingRuns.playerId, player.id), eq(schema.fishingRuns.status, 'running')));
      await tx.update(schema.players).set({ currentBiomeId: body.biomeId }).where(eq(schema.players.id, player.id));
    });
    const updated = (await db.select().from(schema.players).where(eq(schema.players.id, player.id)))[0];
    const session = await buildSession(updated);
    return { player: session.player, publicIdentity: session.publicIdentity, serverTime: session.serverTime };
  };
  app.put('/api/player/current-biome', switchPersonalBiome);

  app.get('/api/fishpedia', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const biomeId = String((req.query as any).biomeId ?? 'b_001');
    const biome = (await db.select().from(schema.biomes).where(eq(schema.biomes.id, biomeId)))[0];
    if (!biome) throw new AppError('BIOME_NOT_FOUND', '地图不存在。');

    const [fishRows, inv] = await Promise.all([
      db.select().from(schema.fish).where(eq(schema.fish.biomeId, biomeId)),
      db.select().from(schema.playerInventoryFish).where(eq(schema.playerInventoryFish.playerId, player.id)),
    ]);

    const invMap = new Map(inv.map((i) => [i.fishId, i]));
    const discovered = fishRows.filter((f) => invMap.has(f.id));
    const rarityProgress = RARITY_ORDER.map((r) => {
      const all = fishRows.filter((f) => f.rarity === r);
      const disc = all.filter((f) => invMap.has(f.id));
      return { rarity: r, discovered: disc.length, total: all.length };
    });

    return {
      biome: { id: biome.id, name: biome.name, isUnlocked: true },
      progress: {
        discovered: discovered.length,
        total: fishRows.length,
        percentage: Math.round((discovered.length / Math.max(1, fishRows.length)) * 10000) / 100,
      },
      rarityProgress,
      fish: fishRows.map((f) => {
        const rec = invMap.get(f.id);
        return {
          fishId: f.id,
          name: f.name,
          description: f.description,
          rarity: f.rarity,
          sellPrice: f.sellPrice,
          imagePath: f.imagePath,
          isDiscovered: !!rec,
          quantity: rec?.quantity ?? 0,
          totalCaught: rec?.totalCaught ?? 0,
          firstCaughtAt: rec?.firstCaughtAt?.toISOString() ?? null,
          lastCaughtAt: rec?.lastCaughtAt?.toISOString() ?? null,
        };
      }),
      serverTime: new Date().toISOString(),
    };
  });

  app.get('/api/rods', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const [rods, playerRods] = await Promise.all([
      db.select().from(schema.rods).orderBy(schema.rods.orderIndex),
      db.select().from(schema.playerRods).where(eq(schema.playerRods.playerId, player.id)),
    ]);
    const rodMap = new Map(playerRods.map((r) => [r.rodId, r]));

    return {
      rods: rods.map((r) => {
        const owned = rodMap.get(r.id);
        const isOwned = owned?.isOwned ?? false;
        const isEquipped = player.equippedRodId === r.id && isOwned;
        const level = owned?.level ?? 1;
        const stats = { strength: 0, intelligence: 0, luck: 0, endurance: 0 };
        for (const [k, v] of Object.entries(r.statPerLevel ?? {})) {
          stats[k as keyof typeof stats] = (v as number) * Math.max(0, level - 1);
        }
        let nextUpgradeCost: number | null = null;
        if (isOwned && level < r.maxLevel) {
          nextUpgradeCost = Math.floor((r.baseUpgradeCost ?? 0) * Math.pow(r.upgradeCostGrowth ?? 1, level - 1));
        }
        return {
          id: r.id,
          name: r.name,
          description: r.description,
          requiredLevel: r.requiredLevel,
          purchaseCost: r.purchaseCost,
          maxLevel: r.maxLevel,
          isOwned,
          isEquipped,
          canPurchase: player.level >= r.requiredLevel && !isOwned,
          hasEarlyAccess: false,
          level: isOwned ? level : null,
          nextUpgradeCost,
          resetRefundGold: owned?.investedGold ?? 0,
          resetRefundBasisPoints: 7500,
          upgradeOptions: isOwned && level < r.maxLevel
            ? [{ level: level + 1, cost: nextUpgradeCost, stats: r.statPerLevel ?? {} }]
            : [],
          stats,
        };
      }),
    };
  });

  app.get('/api/meta/frontend-release', async () => ({
    version: '0.26.1',
    releasedAt: '2026-10-27',
    changes: [],
    documentation: 'script-api',
    serverTime: new Date().toISOString(),
  }));

  app.get('/api/baits', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const [baits, playerBaits] = await Promise.all([
      db.select().from(schema.baits).orderBy(schema.baits.orderIndex),
      db.select().from(schema.playerBaits).where(eq(schema.playerBaits.playerId, player.id)),
    ]);
    const baitMap = new Map(playerBaits.map((b) => [b.baitId, b]));
    const rarityRange = (min: number, max: number) => {
      if (min === max) return RARITIES[min]?.name ?? '';
      return `${RARITIES[min]?.name ?? ''}至${RARITIES[max]?.name ?? ''}`;
    };
    return {
      baits: baits.map((b) => {
        const owned = baitMap.get(b.id);
        return {
          id: b.id,
          biomeId: null,
          tier: b.tier,
          name: b.name,
          unitPrice: b.unitPrice,
          luck: b.luck,
          rarityRange: rarityRange(b.minRarityIndex, b.maxRarityIndex),
          allowsGear: b.allowsGear,
          allowsChest: b.allowsChest,
          allowsRelic: b.allowsRelic,
          isUnlimited: b.isUnlimited,
          quantity: b.isUnlimited ? null : (owned?.quantity ?? 0),
          isSelected: player.selectedBaitId === b.id,
          autoRefill: owned?.autoRefill ?? false,
          autoRefillQuantity: owned?.autoRefillQuantity ?? 100,
        };
      }),
      autoRefill: baitMap.get(player.selectedBaitId)?.autoRefill ?? false,
    };
  });

  app.post('/api/baits/:baitId/purchase', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const baitId = String((req.params as any).baitId);
    const qty = Math.min(100000, Math.max(1, Number((req.body as any)?.quantity ?? 100)));
    const bait = (await db.select().from(schema.baits).where(eq(schema.baits.id, baitId)))[0];
    if (!bait || bait.isUnlimited) throw new AppError('BAIT_NOT_FOUND', '该鱼饵不可购买。');
    const cost = bait.unitPrice * qty;
    if (player.gold < cost) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: player.gold - cost }).where(eq(schema.players.id, player.id));
      await tx.insert(schema.playerBaits).values({ playerId: player.id, baitId, quantity: qty })
        .onConflictDoUpdate({ target: [schema.playerBaits.playerId, schema.playerBaits.baitId], set: { quantity: sql`${schema.playerBaits.quantity} + ${qty}` } });
    });
    const [baitRow] = await db.select().from(schema.playerBaits).where(and(eq(schema.playerBaits.playerId, player.id), eq(schema.playerBaits.baitId, baitId)));
    const currentPlayer = (await db.select().from(schema.players).where(eq(schema.players.id, player.id)))[0];
    const session = await buildSession(currentPlayer);
    return { player: session.player, baitId, quantity: baitRow?.quantity ?? 0, serverTime: new Date().toISOString() };
  });

  app.post('/api/baits/:baitId/select', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const baitId = String((req.params as any).baitId);
    const bait = (await db.select().from(schema.baits).where(eq(schema.baits.id, baitId)))[0];
    if (!bait) throw new AppError('BAIT_NOT_FOUND', '该鱼饵不存在。');
    await db.update(schema.players).set({ selectedBaitId: baitId }).where(eq(schema.players.id, player.id));
    const currentPlayer = (await db.select().from(schema.players).where(eq(schema.players.id, player.id)))[0];
    const session = await buildSession(currentPlayer);
    return { player: session.player, baitId, serverTime: new Date().toISOString() };
  });

  app.post('/api/baits/:baitId/equip', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const baitId = String((req.params as any).baitId);
    const bait = (await db.select().from(schema.baits).where(eq(schema.baits.id, baitId)))[0];
    if (!bait) throw new AppError('BAIT_NOT_FOUND', '该鱼饵不存在。');
    await db.update(schema.players).set({ selectedBaitId: baitId }).where(eq(schema.players.id, player.id));
    const currentPlayer = (await db.select().from(schema.players).where(eq(schema.players.id, player.id)))[0];
    const session = await buildSession(currentPlayer);
    return { player: session.player, baitId, serverTime: new Date().toISOString() };
  });

  app.put('/api/baits/auto-refill', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = { enabled: Boolean((req.body as any)?.enabled), quantity: Math.min(1000, Math.max(1, Number((req.body as any)?.quantity ?? 100))) };
    await db.update(schema.playerBaits)
      .set({ autoRefill: body.enabled, autoRefillQuantity: body.quantity })
      .where(and(eq(schema.playerBaits.playerId, player.id), eq(schema.playerBaits.baitId, player.selectedBaitId)));
    return { success: true };
  });

  app.get('/api/statistics', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const [biomes, totalFish, stats, weatherCasts, baitCasts, biomeCasts] = await Promise.all([
      db.select().from(schema.biomes).orderBy(schema.biomes.orderIndex),
      db.select().from(schema.fish),
      db.select().from(schema.playerStats).where(eq(schema.playerStats.playerId, player.id)),
      db.select().from(schema.playerWeatherCasts).where(eq(schema.playerWeatherCasts.playerId, player.id)),
      db.select().from(schema.playerBaitCasts).where(eq(schema.playerBaitCasts.playerId, player.id)),
      db.select().from(schema.playerBiomeCasts).where(eq(schema.playerBiomeCasts.playerId, player.id)),
    ]);
    const runs = await db.select().from(schema.fishingRuns).where(eq(schema.fishingRuns.playerId, player.id));
    const st = stats[0];

    const byBiome = new Map<string, { casts: number; fishCaught: number; fishingGold: number; fishingExperience: number }>();
    for (const b of biomes) byBiome.set(b.id, { casts: 0, fishCaught: 0, fishingGold: 0, fishingExperience: 0 });
    const byRarity = new Map<string, number>();
    let totalFishCaught = 0;
    let fishingGold = 0, fishingExperience = 0;
    const byMode = new Map<string, { casts: number; fishCaught: number; fishingGold: number; fishingExperience: number }>();

    for (const r of runs) {
      const castsInRun = r.totalCasts - r.remainingCasts;
      const key = byBiome.get(r.biomeId);
      if (key) {
        key.casts += castsInRun;
        key.fishingGold += r.batchGold;
        key.fishingExperience += r.batchExperience;
      }
      fishingGold += r.batchGold;
      fishingExperience += r.batchExperience;
      const mk = byMode.get(r.mode) ?? { casts: 0, fishCaught: 0, fishingGold: 0, fishingExperience: 0 };
      mk.casts += castsInRun;
      mk.fishingGold += r.batchGold;
      mk.fishingExperience += r.batchExperience;
      byMode.set(r.mode, mk);
      for (const res of (r.results as any[]) ?? []) {
        totalFishCaught += res.quantity ?? 0;
        if (res.kind === 'fish') {
          const bb = byBiome.get(r.biomeId);
          if (bb) bb.fishCaught += res.quantity ?? 0;
          byRarity.set(res.rarity, (byRarity.get(res.rarity) ?? 0) + (res.quantity ?? 0));
          const mm = byMode.get(r.mode);
          if (mm) mm.fishCaught += res.quantity ?? 0;
        }
      }
    }

    const invRows = await db.select().from(schema.playerInventoryFish).where(eq(schema.playerInventoryFish.playerId, player.id));
    const discovered = invRows.filter((i) => i.totalCaught > 0).length;
    const weatherDefs = await db.select().from(schema.weather).orderBy(schema.weather.orderIndex);
    const wMap = new Map(weatherCasts.map((x) => [x.weatherId, x.casts]));

    return {
      totals: {
        totalCasts: player.totalCasts,
        onlineCasts: st?.onlineCasts ?? 0,
        offlineCasts: st?.offlineCasts ?? 0,
        totalFishCaught: player.totalFishCaught,
        discoveredFish: discovered,
        totalFishDefinitions: totalFish.length,
        fishpediaPercentage: Math.round((discovered / Math.max(1, totalFish.length)) * 10000) / 100,
        fishingGold,
        fishingExperience,
        relicDropCount: 0,
        relicQuantity: player.totalRelicQuantity,
        chestsDropped: player.totalChestsDropped,
        gearDropped: player.totalGearDropped,
        npcFishSoldQuantity: player.npcFishSoldQuantity,
        npcFishSoldGold: player.npcFishSoldGold,
        chestsOpened: player.totalChestsOpened,
        gearUpgrades: player.totalGearUpgrades,
      },
      pity: { effectiveLuck: null, luckTier: null, baitId: null, weatherId: null, exotic: { currentDryCasts: 0, maxDryCasts: 0, hardPityCasts: null }, arcane: { currentDryCasts: 0, maxDryCasts: 0, hardPityCasts: null } },
      biomes: biomes.map((b) => {
        const d = byBiome.get(b.id) ?? { casts: 0, fishCaught: 0, fishingGold: 0, fishingExperience: 0 };
        return { biomeId: b.id, name: b.name, ...d };
      }),
      rarities: RARITY_ORDER.map((r) => ({ rarity: r, name: RARITIES[RARITY_ORDER.indexOf(r)]?.name ?? r, fishCaught: byRarity.get(r) ?? 0 })),
      weather: weatherDefs.map((w) => ({ weatherId: w.id, name: w.name, casts: wMap.get(w.id) ?? 0 })),
      modes: [...byMode.entries()].map(([mode, d]) => ({ mode, ...d })),
      serverTime: new Date().toISOString(),
    };
  });


  app.post('/api/rods/:rodId/purchase', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const rodId = String((req.params as any).rodId);
    const rod = (await db.select().from(schema.rods).where(eq(schema.rods.id, rodId)))[0];
    if (!rod) throw new AppError('ROD_NOT_FOUND', '鱼竿不存在。');
    const owned = (await db.select().from(schema.playerRods).where(and(eq(schema.playerRods.playerId, player.id), eq(schema.playerRods.rodId, rodId))))[0];
    if (owned?.isOwned) throw new AppError('ALREADY_OWNED', '已拥有该鱼竿。');
    if (player.level < rod.requiredLevel) throw new AppError('LEVEL_REQUIREMENT', `需要等级 ${rod.requiredLevel} 才能购买。`);
    if (player.gold < rod.purchaseCost) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${rod.purchaseCost}` }).where(eq(schema.players.id, player.id));
      await tx.update(schema.playerRods).set({ isOwned: true }).where(and(eq(schema.playerRods.playerId, player.id), eq(schema.playerRods.rodId, rodId)));
      await tx.update(schema.players).set({ equippedRodId: rodId }).where(eq(schema.players.id, player.id));
    });
    return { player: (await buildSession((await db.select().from(schema.players).where(eq(schema.players.id, player.id)))[0])).player, serverTime: new Date().toISOString() };
  });

  app.post('/api/rods/:rodId/equip', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const rodId = String((req.params as any).rodId);
    const owned = (await db.select().from(schema.playerRods).where(and(eq(schema.playerRods.playerId, player.id), eq(schema.playerRods.rodId, rodId))))[0];
    if (!owned?.isOwned) throw new AppError('ROD_NOT_OWNED', '尚未拥有该鱼竿。');
    await db.update(schema.players).set({ equippedRodId: rodId }).where(eq(schema.players.id, player.id));
    return { player: (await buildSession((await db.select().from(schema.players).where(eq(schema.players.id, player.id)))[0])).player, serverTime: new Date().toISOString() };
  });

  app.post('/api/rods/:rodId/upgrade', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const rodId = String((req.params as any).rodId);
    const [rod, owned] = await Promise.all([
      db.select().from(schema.rods).where(eq(schema.rods.id, rodId)),
      db.select().from(schema.playerRods).where(and(eq(schema.playerRods.playerId, player.id), eq(schema.playerRods.rodId, rodId))),
    ]);
    if (!rod[0]) throw new AppError('ROD_NOT_FOUND', '鱼竿不存在。');
    if (!owned[0]?.isOwned) throw new AppError('ROD_NOT_OWNED', '尚未拥有该鱼竿。');
    if (owned[0].level >= rod[0].maxLevel) throw new AppError('ROD_MAX_LEVEL', '鱼竿已满级。');
    const cost = Math.floor((rod[0].baseUpgradeCost ?? 0) * Math.pow(rod[0].upgradeCostGrowth ?? 1, owned[0].level - 1));
    if (player.gold < cost) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${cost}` }).where(eq(schema.players.id, player.id));
      await tx.update(schema.playerRods).set({
        level: owned[0].level + 1,
        investedGold: owned[0].investedGold + cost,
        upgradeCount: owned[0].upgradeCount + 1,
      }).where(and(eq(schema.playerRods.playerId, player.id), eq(schema.playerRods.rodId, rodId)));
    });
    return { player: (await buildSession((await db.select().from(schema.players).where(eq(schema.players.id, player.id)))[0])).player, serverTime: new Date().toISOString() };
  });

  app.post('/api/rods/:rodId/reset', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const rodId = String((req.params as any).rodId);
    const owned = (await db.select().from(schema.playerRods).where(and(eq(schema.playerRods.playerId, player.id), eq(schema.playerRods.rodId, rodId))))[0];
    if (!owned?.isOwned) throw new AppError('ROD_NOT_OWNED', '尚未拥有该鱼竿。');
    if (owned.level <= 1) throw new AppError('ROD_NOT_UPGRADED', '鱼竿尚未升级。');
    const refund = Math.floor(owned.investedGold * 0.5);
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} + ${refund}` }).where(eq(schema.players.id, player.id));
      await tx.update(schema.playerRods).set({ level: 1, investedGold: 0, upgradeCount: 0 }).where(and(eq(schema.playerRods.playerId, player.id), eq(schema.playerRods.rodId, rodId)));
    });
    return { player: (await buildSession((await db.select().from(schema.players).where(eq(schema.players.id, player.id)))[0])).player, refundGold: refund, serverTime: new Date().toISOString() };
  });

}

function cycleStarted(weatherId: string, biomeId: string): Date {
  void weatherId;
  void biomeId;
  return new Date(Math.floor(Date.now() / (2 * 60 * 60 * 1000)) * (2 * 60 * 60 * 1000));
}
