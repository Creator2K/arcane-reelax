import { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { requireAuth } from '../services/auth.js';
import { AppError } from '../util/errors.js';
import { loadPlayerContext, xpForCast, levelMultiplier } from '../services/playerState.js';
import { getWeatherForBiome } from '../services/weather.js';
import { RARITIES, RARITY_ORDER, LEVEL_EXP_FORMULA } from '../constants.js';
import { chinaDate } from './auth.js';
import { randomUUID } from 'node:crypto';
import { syncAchievementProgress } from '../services/achievements.js';
import { z } from 'zod';

const OFFLINE_AFTER_MS = 60 * 1000;

export async function registerFishingRoutes(app: FastifyInstance) {
  app.post('/api/fishing/start', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = zStart.parse((req.body ?? {}) as any);
    const mode = body.mode === 'offline' ? 'offline' : 'online';

    // stop any existing run and settle it
    await settleAllRuns(player.id);

    const ctx = await loadPlayerContext(player.id);
    const biome = ctx.currentBiome;
    if (!biome) throw new AppError('BIOME_NOT_FOUND', '当前地图不存在。');

    const totalEndurance = ctx.stats.total.endurance;
    const totalCasts = Math.max(100, totalEndurance * 2);

    // check bait availability
    const baitId = player.selectedBaitId;
    const bait = (await db.select().from(schema.baits).where(eq(schema.baits.id, baitId)))[0];
    if (!bait) throw new AppError('BAIT_NOT_FOUND', '鱼饵不存在。');
    const playerBait = (await db.select().from(schema.playerBaits).where(and(
      eq(schema.playerBaits.playerId, player.id), eq(schema.playerBaits.baitId, baitId),
    )))[0];

    let effectiveBaitId = baitId;
    if (!bait.isUnlimited && (playerBait?.quantity ?? 0) <= 0) {
      // fall back to basic bait
      const basic = (await db.select().from(schema.baits).where(eq(schema.baits.id, 'bait_basic')))[0];
      effectiveBaitId = 'bait_basic';
      void basic;
      await db.update(schema.players).set({ selectedBaitId: 'bait_basic' }).where(eq(schema.players.id, player.id));
    }

    const { weather } = await getWeatherForBiome(biome.id);
    const snapshot = buildSnapshot(ctx, biome, weather.id);

    const now = new Date();
    const run = (await db.insert(schema.fishingRuns).values({
      playerId: player.id,
      status: 'running',
      mode,
      biomeId: biome.id,
      totalCasts,
      remainingCasts: totalCasts,
      cycleDurationMs: 6000,
      startedAt: now,
      nextCastAt: new Date(now.getTime() + 6000),
      lastSyncAt: now,
      snapshot,
      snapshotKey: `A${Math.random().toString(36).slice(2, 10)}`,
      results: [],
    }).returning())[0];

    await db.update(schema.players).set({ selectedBaitId: effectiveBaitId }).where(eq(schema.players.id, player.id));

    return buildFishingState(player.id, run);
  });

  app.post('/api/fishing/sync', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const run = (await db.select().from(schema.fishingRuns).where(and(
      eq(schema.fishingRuns.playerId, player.id),
      eq(schema.fishingRuns.status, 'running'),
    )).orderBy(desc(schema.fishingRuns.startedAt)).limit(1))[0];

    if (!run) {
      return { run: null, lastResult: null, batchSummary: emptySummary(), ...await fishingExtras(player.id), serverTime: new Date().toISOString() };
    }

    // If run went offline (no sync for >1min), settle offline progress
    const now = Date.now();
    const lastSync = run.lastSyncAt.getTime();
    const castInterval = run.cycleDurationMs;

    if (run.mode === 'offline' || now - lastSync > OFFLINE_AFTER_MS) {
      const previousResultCount = (run.results ?? []).length;
      const run2 = await settleDueCasts(player.id, run, castInterval);
      const settledResults = (run2.results ?? []).slice(previousResultCount);
      const resumed = run2.status === 'running'
        ? (await db.update(schema.fishingRuns).set({
            mode: 'online',
            lastSyncAt: new Date(),
            nextCastAt: new Date(Date.now() + castInterval),
          }).where(eq(schema.fishingRuns.id, run2.id)).returning())[0]
        : run2;
      return buildFishingState(player.id, resumed, summarizeSettlement(settledResults, 'offline'));
    }

    // normal online: settle casts whose nextCastAt has passed (at most a few)
    const settled = await settleOnlineDue(player.id, run, castInterval, run.mode);
    return buildFishingState(player.id, settled);
  });

  app.post('/api/fishing/refill', async (req, reply) => {
    const player = await requireAuth(req, reply);
    await settleAllRuns(player.id);
    const ctx = await loadPlayerContext(player.id);
    const totalEndurance = ctx.stats.total.endurance;
    const totalCasts = Math.max(100, totalEndurance * 2);
    const run = (await db.insert(schema.fishingRuns).values({
      playerId: player.id,
      status: 'running',
      mode: 'online',
      biomeId: player.currentBiomeId,
      totalCasts,
      remainingCasts: totalCasts,
      cycleDurationMs: 6000,
      startedAt: new Date(),
      nextCastAt: new Date(Date.now() + 6000),
      lastSyncAt: new Date(),
      snapshot: {},
      results: [],
    }).returning())[0];
    await db.update(schema.players).set({ selectedBaitId: player.selectedBaitId }).where(eq(schema.players.id, player.id));
    return buildFishingState(player.id, run);
  });

  app.post('/api/fishing/stop', async (req, reply) => {
    const player = await requireAuth(req, reply);
    await settleAllRuns(player.id);
    return { success: true, ...await fishingExtras(player.id), serverTime: new Date().toISOString() };
  });

  app.get('/api/fishing/state', async (req, reply) => {
    const player = await requireAuth(req, reply);
    // settle offline if any
    const run = (await db.select().from(schema.fishingRuns).where(and(
      eq(schema.fishingRuns.playerId, player.id),
      eq(schema.fishingRuns.status, 'running'),
    )).orderBy(desc(schema.fishingRuns.startedAt)).limit(1))[0];
    if (run && Date.now() - run.lastSyncAt.getTime() > OFFLINE_AFTER_MS) {
      const settled = await settleDueCasts(player.id, run, run.cycleDurationMs);
      return buildFishingState(player.id, settled);
    }
    if (run && run.nextCastAt && Date.now() >= run.nextCastAt.getTime()) {
      const settled = await settleOnlineDue(player.id, run, run.cycleDurationMs, run.mode);
      return buildFishingState(player.id, settled);
    }
    return buildFishingState(player.id, run ?? null);
  });


}

const zStart = z.object({ mode: z.enum(['online', 'offline']).optional().default('online') });

function buildSnapshot(ctx: any, biome: any, weatherId: string) {
  return {
    biomeId: biome.id,
    totalCasts: 0,
    cycleDurationMs: 6000,
    startedAt: new Date().toISOString(),
    stats: {
      strength: ctx.stats.total.strength,
      intelligence: ctx.stats.total.intelligence,
      luck: ctx.stats.total.luck,
      endurance: ctx.stats.total.endurance,
    },
    effects: {
      mapMasteryLevel: 0,
      mapXpBonusBasisPoints: 0,
      mapDirectGoldBonusBasisPoints: 0,
      talentRanks: ctx.talents,
      globalXpBonusBasisPoints: 0,
      globalDirectGoldBonusBasisPoints: 0,
      directGoldMinBonus: 0,
      directGoldMaxBonus: 0,
      gildedGoldMinBonus: 0,
      gildedGoldMaxBonus: 0,
      guild: null,
    },
    weatherId,
  };
}

async function settleOnlineDue(playerId: string, run: any, castInterval: number, mode: string) {
  const now = Date.now();
  const nextCastAt = run.nextCastAt ? run.nextCastAt.getTime() : now;
  let due = Math.floor((now - nextCastAt) / castInterval) + 1;
  due = Math.max(0, Math.min(due, run.remainingCasts, 5));
  if (due <= 0) return run;

  const results: any[] = [];
  let gold = 0, exp = 0, fishQty = 0, relics = 0, chests = 0, gearCount = 0, guildTax = 0, partyExp = 0;

  for (let i = 0; i < due; i++) {
    const result = await rollCast(playerId, run, mode);
    if (!result) break;
    results.push(result);
    gold += result.gold ?? 0;
    exp += result.experience ?? 0;
    fishQty += result.quantity ?? 0;
    relics += result.relics ?? 0;
    chests += result.chests ?? 0;
    gearCount += result.gearCount ?? 0;
  }

  const remaining = run.remainingCasts - due;
  const ended = remaining <= 0;
  const newNext = new Date(run.nextCastAt.getTime() + due * castInterval);

  const [updated] = await db.update(schema.fishingRuns)
    .set({
      remainingCasts: Math.max(0, remaining),
      nextCastAt: newNext,
      lastSyncAt: new Date(),
      mode: ended ? run.mode : mode,
      status: ended ? 'completed' : 'running',
      endedAt: ended ? new Date() : undefined,
      endReason: ended ? 'batch_completed' : undefined,
      results: [...(run.results ?? []), ...results],
      batchGold: Number(run.batchGold) + gold,
      batchExperience: Number(run.batchExperience) + exp,
      batchFishQuantity: Number(run.batchFishQuantity) + fishQty,
      batchRelics: Number(run.batchRelics) + relics,
      batchChests: Number(run.batchChests) + chests,
      batchGearCount: Number(run.batchGearCount) + gearCount,
      guildTaxGold: Number(run.guildTaxGold) + guildTax,
      partyBonusExperience: Number(run.partyBonusExperience) + partyExp,
    })
    .where(eq(schema.fishingRuns.id, run.id))
    .returning();

  await applyCastRewards(playerId, results);
  return updated;
}

async function settleDueCasts(playerId: string, run: any, castInterval: number) {
  const now = Date.now();
  const lastSync = run.lastSyncAt.getTime();
  const due = Math.floor((now - lastSync) / castInterval);
  if (due <= 0) return run;

  const results: any[] = [];
  let gold = 0, exp = 0, fishQty = 0, relics = 0, chests = 0, gearCount = 0;

  for (let i = 0; i < Math.min(due, run.remainingCasts); i++) {
    const result = await rollCast(playerId, run, 'offline');
    if (!result) break;
    results.push(result);
    gold += result.gold ?? 0;
    exp += result.experience ?? 0;
    fishQty += result.quantity ?? 0;
    relics += result.relics ?? 0;
    chests += result.chests ?? 0;
    gearCount += result.gearCount ?? 0;
  }

  const remaining = Math.max(0, run.remainingCasts - due);
  const ended = remaining <= 0;

  const [updated] = await db.update(schema.fishingRuns)
    .set({
      remainingCasts: remaining,
      lastSyncAt: new Date(),
      mode: ended ? 'offline' : 'offline',
      status: ended ? 'completed' : 'running',
      endedAt: ended ? new Date() : undefined,
      endReason: ended ? 'batch_completed' : undefined,
      results: [...(run.results ?? []), ...results],
      batchGold: Number(run.batchGold) + gold,
      batchExperience: Number(run.batchExperience) + exp,
      batchFishQuantity: Number(run.batchFishQuantity) + fishQty,
      batchRelics: Number(run.batchRelics) + relics,
      batchChests: Number(run.batchChests) + chests,
      batchGearCount: Number(run.batchGearCount) + gearCount,
      nextCastAt: new Date(now + castInterval),
    })
    .where(eq(schema.fishingRuns.id, run.id))
    .returning();

  await applyCastRewards(playerId, results);
  return updated;
}

async function settleAllRuns(playerId: string) {
  const runs = await db.select().from(schema.fishingRuns).where(and(
    eq(schema.fishingRuns.playerId, playerId),
    eq(schema.fishingRuns.status, 'running'),
  ));
  for (const run of runs) {
    await settleDueCasts(playerId, run, run.cycleDurationMs);
  }
}

async function rollCast(playerId: string, run: any, mode: string): Promise<any | null> {
  const snapshot = run.snapshot ?? {};
  const biomeId = snapshot.biomeId ?? run.biomeId;
  const weatherId = snapshot.weatherId ?? 'clear';
  const playerRow = (await db.select().from(schema.players).where(eq(schema.players.id, playerId)))[0];
  const selectedBaitId = playerRow?.selectedBaitId ?? 'bait_basic';

  const [biome, weatherRow, baitDef, playerBait] = await Promise.all([
    db.select().from(schema.biomes).where(eq(schema.biomes.id, biomeId)),
    db.select().from(schema.weather).where(eq(schema.weather.id, weatherId)),
    db.select().from(schema.baits).where(eq(schema.baits.id, selectedBaitId)),
    db.select().from(schema.playerBaits).where(and(eq(schema.playerBaits.playerId, playerId), eq(schema.playerBaits.baitId, selectedBaitId))),
  ]);

  const b = biome[0];
  const w = weatherRow[0];
  const bait = baitDef[0];
  if (!b) return null;

  const stats = snapshot.stats ?? { strength: 0, intelligence: 0, luck: 0, endurance: 100 };
  const effectiveLuck = stats.luck ?? 0;

  // pick rarity
  const rarity = rollRarity(bait, w, effectiveLuck) as (typeof RARITY_ORDER)[number];
  // pick fish of that rarity in biome
  const fishOfRarity = await db.select().from(schema.fish).where(and(eq(schema.fish.biomeId, biomeId), eq(schema.fish.rarity, rarity)));
  if (!fishOfRarity.length) return null;
  const fishRow = fishOfRarity[Math.floor(Math.random() * fishOfRarity.length)];

  // quantity: strength based for low rarities
  let quantity = 1;
  const rarityIndex = RARITY_ORDER.indexOf(rarity);
  if (rarityIndex <= 4) {
    const strength = stats.strength ?? 0;
    quantity = 1 + Math.floor(Math.random() * (1 + Math.floor(strength / 10)));
    quantity = Math.min(quantity, rarityIndex <= 1 ? 5 : 3);
  }

  // direct gold
  const goldRange = [b.directGoldMin, b.directGoldMax];
  let directGold = Math.floor(Math.random() * (goldRange[1] - goldRange[0] + 1)) + goldRange[0];
  directGold = Math.floor(directGold * b.valueMultiplier);
  if (w?.directGoldRangeBonus) directGold += Math.floor(Math.random() * (w.directGoldRangeBonus[1] - w.directGoldRangeBonus[0] + 1)) + w.directGoldRangeBonus[0];

  // XP
  const intelMult = Math.min(6, 1 + (stats.intelligence ?? 0) / 100);
  const exp = Math.floor(
    (6.5 + Math.random() * 0.5) *
    levelMultiplier(playerRow.level) *
    rarityMult(rarity) *
    (w?.xpMultiplier ?? 1) *
    intelMult,
  );

  // relic/chest/gear drops
  let relics = 0, chests = 0, gearCount = 0;
  if (bait?.allowsRelic) {
    const relicChance = 0.002 + effectiveLuck / 200000;
    if (Math.random() < relicChance) relics = 1;
  }
  if (bait?.allowsChest) {
    const chestChance = 0.0008 + effectiveLuck / 400000;
    if (Math.random() < chestChance) chests = 1;
  }
  if (bait?.allowsGear && rarityIndex >= 2) {
    const gearChance = 0.0005 + effectiveLuck / 600000;
    if (Math.random() < gearChance) gearCount = 1;
  }

  // Actually grant gear / chest items on drop
  let gearId: string | null = null;
  if (gearCount > 0) {
    const gear = await generateDroppedGear(playerId, biomeId, rarityIndex);
    gearId = gear?.id ?? null;
  }
  if (chests > 0) {
    const chestDef = (await db.select().from(schema.chests).where(eq(schema.chests.id, 'rusted_gear_chest')))[0];
    if (chestDef) {
      await db.insert(schema.playerChests).values({ playerId, chestId: chestDef.id, quantity: chests })
        .onConflictDoUpdate({ target: [schema.playerChests.playerId, schema.playerChests.chestId], set: { quantity: sql`${schema.playerChests.quantity} + ${chests}` } });
    }
  }

  // consume bait (with auto-refill when stock runs out)
  let baitCost = 0;
  if (bait && !bait.isUnlimited) {
    let pb = playerBait[0];
    if (pb && pb.quantity <= 0 && pb.autoRefill) {
      // auto-buy a pack of autoRefillQuantity
      const qty = Math.max(1, pb.autoRefillQuantity || 100);
      const cost = bait.unitPrice * qty;
      const playerGold = (await db.select({ gold: schema.players.gold }).from(schema.players).where(eq(schema.players.id, playerId)))[0];
      if (playerGold && playerGold.gold >= cost) {
        await db.transaction(async (tx) => {
          await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${cost}` }).where(eq(schema.players.id, playerId));
          await tx.update(schema.playerBaits).set({ quantity: qty }).where(and(eq(schema.playerBaits.playerId, playerId), eq(schema.playerBaits.baitId, bait.id)));
        });
        const fresh = (await db.select().from(schema.playerBaits).where(and(eq(schema.playerBaits.playerId, playerId), eq(schema.playerBaits.baitId, bait.id))))[0];
        pb = fresh ?? pb;
      }
    }
    if (pb && pb.quantity > 0) {
      baitCost = bait.unitPrice;
      await db.update(schema.playerBaits).set({ quantity: pb.quantity - 1 }).where(and(
        eq(schema.playerBaits.playerId, playerId), eq(schema.playerBaits.baitId, bait.id),
      ));
    }
  }

  return {
    id: randomUUID(),
    kind: gearCount > 0 ? 'gear' : chests > 0 ? 'chest' : relics > 0 ? 'relic' : 'fish',
    fishId: fishRow.id,
    name: fishRow.name,
    gearId,
    rarity,
    quantity,
    gold: directGold,
    experience: exp,
    relics,
    chests,
    gearCount,
    baitCost,
    baitId: selectedBaitId,
    biomeId,
    biomeName: b.name,
    mode,
    weatherId,
    caughtAt: new Date().toISOString(),
  };
}

async function generateDroppedGear(playerId: string, biomeId: string, rarityIndex: number): Promise<{ id: string } | null> {
  const templates = await db.select().from(schema.gearTemplates);
  const pool = templates.filter((t) => t.minRarityIndex <= rarityIndex && t.maxRarityIndex >= rarityIndex);
  const template = (pool.length ? pool : templates)[Math.floor(Math.random() * (pool.length ? pool.length : templates.length))];
  if (!template) return null;
  const rarity = RARITY_ORDER[Math.max(0, Math.min(RARITY_ORDER.length - 1, rarityIndex))];
  const quality = Math.min(100, Math.max(1, Math.round(1 + (rarityIndex / 8) * 60 + Math.random() * 39)));
  const baseStats: Record<string, number> = {};
  const range = template.baseStatRange as Record<string, [number, number]>;
  const qualityMult = 1 + quality / 200;
  for (const [k, [min, max]] of Object.entries(range)) {
    baseStats[k] = Math.max(0, Math.round((min + Math.random() * (max - min)) * qualityMult));
  }
  const gear = (await db.insert(schema.gearItems).values({
    ownerId: playerId,
    templateId: template.id,
    name: template.name,
    slot: template.slot,
    rarity,
    quality,
    qualityStars: Math.min(5, Math.max(1, Math.round(quality / 20))),
    baseStats,
    upgradeLevel: 0,
    sourceBiomeId: biomeId,
  }).returning())[0];
  await db.update(schema.players).set({ totalGearDropped: sql`${schema.players.totalGearDropped} + 1` }).where(eq(schema.players.id, playerId));
  return gear;
}

function rarityMult(rarity: string): number {
  const map: Record<string, number> = {
    common: 1.05, uncommon: 1.15, fine: 1.3, rare: 1.5, epic: 1.8,
    legendary: 2.2, mythic: 2.8, exotic: 3.6, arcane: 5.0,
  };
  return map[rarity] ?? 1.05;
}

function rollRarity(bait: any, weather: any, luck: number): string {
  const minIdx = bait?.minRarityIndex ?? 0;
  const maxIdx = bait?.maxRarityIndex ?? 1;
  const weatherMult = weather?.rarityMultipliers ?? {};

  // weighted distribution with luck shift
  const weights: number[] = [];
  for (let i = minIdx; i <= maxIdx; i++) {
    const rarityId = RARITY_ORDER[i];
    let w = [70, 20, 5, 2.5, 1.2, 0.6, 0.35, 0.2, 0.1][i] ?? 0.1;
    w *= (weatherMult[rarityId] ?? 1);
    // luck shifts weight upward
    const shift = Math.min(6, luck / 500);
    if (i <= maxIdx) w *= Math.pow(1.25, shift);
    if (i > minIdx) w *= Math.pow(1.1, shift);
    weights.push(w);
  }
  const total = weights.reduce((s, x) => s + x, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return RARITY_ORDER[minIdx + i];
  }
  return RARITY_ORDER[maxIdx];
}

async function applyCastRewards(playerId: string, results: any[]) {
  if (!results.length) return;
  const player = (await db.select().from(schema.players).where(eq(schema.players.id, playerId)))[0];
  let gold = 0, exp = 0, fishQty = 0, relics = 0;
  const fishByRarity: Record<string, number> = {};

  for (const r of results) {
    gold += r.gold ?? 0;
    exp += r.experience ?? 0;
    relics += r.relics ?? 0;
    if (r.kind === 'fish') {
      fishQty += r.quantity ?? 0;
      fishByRarity[r.rarity] = (fishByRarity[r.rarity] ?? 0) + (r.quantity ?? 0);
      // add to inventory
      await db.insert(schema.playerInventoryFish).values({
        playerId, fishId: r.fishId, quantity: r.quantity ?? 0,
        totalCaught: r.quantity ?? 0, firstCaughtAt: new Date(r.caughtAt), lastCaughtAt: new Date(r.caughtAt),
      }).onConflictDoUpdate({
        target: [schema.playerInventoryFish.playerId, schema.playerInventoryFish.fishId],
        set: {
          quantity: sql`${schema.playerInventoryFish.quantity} + ${r.quantity ?? 0}`,
          totalCaught: sql`${schema.playerInventoryFish.totalCaught} + ${r.quantity ?? 0}`,
          lastCaughtAt: new Date(r.caughtAt),
        },
      });
    }
  }

  const newGold = player.gold + gold;
  let newExp = player.experience + exp;
  let newLevel = player.level;
  let unspent = player.unspentStatPoints;

  // level ups
  while (newExp >= LEVEL_EXP_FORMULA(newLevel)) {
    newExp -= LEVEL_EXP_FORMULA(newLevel);
    newLevel += 1;
    unspent += 3;
  }

  const today = chinaDate();
  const todayRow = (await db.select().from(schema.dailyHarvest).where(and(
    eq(schema.dailyHarvest.playerId, playerId), eq(schema.dailyHarvest.date, today),
  )))[0];
  if (todayRow) {
    await db.update(schema.dailyHarvest).set({
      casts: todayRow.casts + results.length,
      fishByRarity: mergeRarity(todayRow.fishByRarity ?? {}, fishByRarity),
      goldIncome: todayRow.goldIncome + gold,
      netGold: todayRow.netGold + gold,
    }).where(and(eq(schema.dailyHarvest.playerId, playerId), eq(schema.dailyHarvest.date, today)));
  } else {
    await db.insert(schema.dailyHarvest).values({
      playerId, date: today, casts: results.length, fishByRarity, goldIncome: gold, netGold: gold,
    });
  }

  await db.update(schema.players).set({
    gold: newGold,
    experience: newExp,
    level: newLevel,
    unspentStatPoints: unspent,
    relics: player.relics + relics,
    totalCasts: player.totalCasts + results.length,
    totalFishCaught: player.totalFishCaught + fishQty,
    totalRelicQuantity: sql`${schema.players.totalRelicQuantity} + ${relics}`,
    totalChestsDropped: sql`${schema.players.totalChestsDropped} + ${results.reduce((sum, r) => sum + (r.chests ?? 0), 0)}`,
  }).where(eq(schema.players.id, playerId));

  // record per-dimension cast stats (weather / bait / biome / online-offline)
  const first = results[0];
  const weatherId = first?.weatherId ?? 'clear';
  const baitId = first?.baitId ?? player.selectedBaitId;
  const biomeId = first?.biomeId ?? 'b_001';
  const isOffline = first?.mode === 'offline';
  await Promise.all([
    db.insert(schema.playerWeatherCasts).values({ playerId, weatherId, casts: results.length })
      .onConflictDoUpdate({ target: [schema.playerWeatherCasts.playerId, schema.playerWeatherCasts.weatherId], set: { casts: sql`${schema.playerWeatherCasts.casts} + ${results.length}` } }),
    db.insert(schema.playerBaitCasts).values({ playerId, baitId, casts: results.length })
      .onConflictDoUpdate({ target: [schema.playerBaitCasts.playerId, schema.playerBaitCasts.baitId], set: { casts: sql`${schema.playerBaitCasts.casts} + ${results.length}` } }),
    db.insert(schema.playerBiomeCasts).values({ playerId, biomeId, casts: results.length })
      .onConflictDoUpdate({ target: [schema.playerBiomeCasts.playerId, schema.playerBiomeCasts.biomeId], set: { casts: sql`${schema.playerBiomeCasts.casts} + ${results.length}` } }),
    db.insert(schema.playerStats).values({ playerId, onlineCasts: isOffline ? 0 : results.length, offlineCasts: isOffline ? results.length : 0 })
      .onConflictDoUpdate({
        target: [schema.playerStats.playerId],
        set: {
          onlineCasts: sql`${schema.playerStats.onlineCasts} + ${isOffline ? 0 : results.length}`,
          offlineCasts: sql`${schema.playerStats.offlineCasts} + ${isOffline ? results.length : 0}`,
        },
      }),
  ]);

  // first-time rarity milestones
  for (const r of results) {
    if (r.kind === 'fish') {
      if (r.rarity === 'legendary') {
        await db.update(schema.playerStats).set({ firstLegendaryAt: sql`COALESCE(${schema.playerStats.firstLegendaryAt}, ${new Date(r.caughtAt)})` }).where(eq(schema.playerStats.playerId, playerId));
      } else if (r.rarity === 'mythic') {
        await db.update(schema.playerStats).set({ firstMythicAt: sql`COALESCE(${schema.playerStats.firstMythicAt}, ${new Date(r.caughtAt)})` }).where(eq(schema.playerStats.playerId, playerId));
      } else if (r.rarity === 'exotic') {
        await db.update(schema.playerStats).set({ firstExoticAt: sql`COALESCE(${schema.playerStats.firstExoticAt}, ${new Date(r.caughtAt)})` }).where(eq(schema.playerStats.playerId, playerId));
      } else if (r.rarity === 'arcane') {
        await db.update(schema.playerStats).set({ firstArcaneAt: sql`COALESCE(${schema.playerStats.firstArcaneAt}, ${new Date(r.caughtAt)})` }).where(eq(schema.playerStats.playerId, playerId));
      }
    }
  }

  // rare+ catches broadcast to the whole server
  await broadcastRareCatch(playerId, results);

  // tournament scoring: target fish caught during active tournaments
  await scoreTournamentCatches(playerId, results);

  // update quests progress
  await updateQuestProgress(playerId, { casts: results.length, fishByRarity, weatherId, mode: first?.mode ?? 'online', results });

  // sync achievements (fire and forget)
  syncAchievementProgress(playerId).catch(() => {});
}

async function scoreTournamentCatches(playerId: string, results: any[]) {
  const now = new Date();
  const [activeTournaments, guildMember] = await Promise.all([
    db.select().from(schema.tournaments).where(eq(schema.tournaments.status, 'active')),
    db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, playerId)),
  ]);
  if (!activeTournaments.length) return;

  const fishIds = new Set(results.filter((r) => r.kind === 'fish').map((r) => r.fishId));
  for (const t of activeTournaments) {
    const targets = (t.targets as Array<{ fishId: string; rarity: string; pointsPerFish: number }>) ?? [];
    const targetMap = new Map(targets.map((tg) => [tg.fishId, tg]));
    const caughtHere = results.filter((r) => r.kind === 'fish' && targetMap.has(r.fishId));
    if (!caughtHere.length) continue;

    let points = 0;
    for (const r of caughtHere) {
      const tg = targetMap.get(r.fishId)!;
      points += tg.pointsPerFish * (r.quantity ?? 1);
    }

    if (t.type === 'personal') {
      const reg = (await db.select().from(schema.tournamentRegistrations).where(and(
        eq(schema.tournamentRegistrations.tournamentId, t.id),
        eq(schema.tournamentRegistrations.playerId, playerId),
      )))[0];
      if (reg && reg.groupId) {
        // check the fish belongs to the player's group targets
        await db.update(schema.tournamentRegistrations).set({ score: sql`${schema.tournamentRegistrations.score} + ${points}` })
          .where(eq(schema.tournamentRegistrations.id, reg.id));
        await db.insert(schema.tournamentCatchEvents).values({
          tournamentId: t.id, playerId, fishId: caughtHere[0].fishId, points, quantity: caughtHere.reduce((sum, r) => sum + (r.quantity ?? 1), 0),
        });
      }
    } else if (t.type === 'guild' && guildMember[0]) {
      const reg = (await db.select().from(schema.tournamentRegistrations).where(and(
        eq(schema.tournamentRegistrations.tournamentId, t.id),
        eq(schema.tournamentRegistrations.guildId, guildMember[0].guildId),
      )))[0];
      if (reg) {
        await db.update(schema.tournamentRegistrations).set({ score: sql`${schema.tournamentRegistrations.score} + ${points}` })
          .where(eq(schema.tournamentRegistrations.id, reg.id));
        await db.insert(schema.tournamentCatchEvents).values({
          tournamentId: t.id, playerId, guildId: guildMember[0].guildId, fishId: caughtHere[0].fishId, points, quantity: caughtHere.reduce((sum, r) => sum + (r.quantity ?? 1), 0),
        });
      }
    }
  }
}

async function broadcastRareCatch(playerId: string, results: any[]) {
  const rare = results.find((r) => r.kind === 'fish' && ['mythic', 'exotic', 'arcane'].includes(r.rarity));
  if (!rare) return;
  await db.insert(schema.globalNotifications).values({
    kind: 'rare_catch',
    playerId,
    fishId: rare.fishId,
    quantity: rare.quantity ?? 1,
    startsAt: new Date(rare.caughtAt ?? Date.now()),
    endsAt: new Date(new Date(rare.caughtAt ?? Date.now()).getTime() + 5 * 60 * 1000),
  });
}

function mergeRarity(a: Record<string, number>, b: Record<string, number>) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}

async function updateQuestProgress(playerId: string, args: { casts: number; fishByRarity: Record<string, number>; weatherId: string | null; mode: string | null; results: any[] }) {
  const quests = await db.select().from(schema.playerQuests).where(and(
    eq(schema.playerQuests.playerId, playerId),
    eq(schema.playerQuests.status, 'in_progress'),
  ));
  if (!quests.length) return;

  // aggregate per-dimension counts from results
  const biomeFish = new Map<string, number>();
  const baitFish = new Map<string, number>();
  const rarityFish = new Map<string, number>();
  for (const r of args.results) {
    if (r.kind !== 'fish') continue;
    const qty = r.quantity ?? 1;
    biomeFish.set(r.biomeId, (biomeFish.get(r.biomeId) ?? 0) + qty);
    rarityFish.set(r.rarity, (rarityFish.get(r.rarity) ?? 0) + qty);
    if (r.baitId) baitFish.set(r.baitId, (baitFish.get(r.baitId) ?? 0) + qty);
  }

  for (const q of quests) {
    let delta = 0;
    switch (q.objectiveType) {
      case 'casts_total':
        delta = args.casts;
        break;
      case 'casts_in_mode':
        delta = args.mode === q.settlementMode ? args.casts : 0;
        break;
      case 'casts_in_weather':
        delta = q.weatherId === args.weatherId ? args.casts : 0;
        break;
      case 'fish_total':
        delta = Object.values(args.fishByRarity).reduce((a, b) => a + b, 0);
        break;
      case 'fish_in_biome':
        delta = q.biomeId ? (biomeFish.get(q.biomeId) ?? 0) : 0;
        break;
      case 'fish_rarity_at_least': {
        const minIdx = ['common', 'uncommon', 'fine', 'rare', 'epic', 'legendary', 'mythic', 'exotic', 'arcane'].indexOf(q.rarity ?? 'common');
        let total = 0;
        for (const [rar, qty] of rarityFish) {
          const idx = ['common', 'uncommon', 'fine', 'rare', 'epic', 'legendary', 'mythic', 'exotic', 'arcane'].indexOf(rar);
          if (idx >= minIdx) total += qty;
        }
        delta = total;
        break;
      }
      case 'fish_with_specific_bait':
        delta = q.baitId ? (baitFish.get(q.baitId) ?? 0) : 0;
        break;
      default:
        break;
    }
    if (delta > 0) {
      const progress = Math.min(Number(q.target), Number(q.progress) + delta);
      const status = progress >= Number(q.target) ? 'completed' : 'in_progress';
      await db.update(schema.playerQuests).set({
        progress,
        status,
        completedAt: status === 'completed' ? new Date() : undefined,
      }).where(eq(schema.playerQuests.id, q.id));
    }
  }
}

async function getDailyHarvest(playerId: string) {
  const today = chinaDate();
  const row = (await db.select().from(schema.dailyHarvest).where(and(
    eq(schema.dailyHarvest.playerId, playerId), eq(schema.dailyHarvest.date, today),
  )))[0];
  if (!row) return { date: today, casts: 0, fishByRarity: {}, gear: 0, chests: 0, relics: 0, goldIncome: 0, baitCost: 0, netGold: 0 };
  return row;
}

async function fishingExtras(playerId: string) {
  const [dailyHarvest, onlineCount, player, membership, entitlements, lighthouseSetting] = await Promise.all([
    getDailyHarvest(playerId),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.fishingRuns).where(eq(schema.fishingRuns.status, 'running')),
    db.select().from(schema.players).where(eq(schema.players.id, playerId)),
    db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, playerId)),
    db.select().from(schema.convenienceEntitlements).where(eq(schema.convenienceEntitlements.playerId, playerId)),
    db.select().from(schema.globalSettings).where(eq(schema.globalSettings.key, 'lighthouse-lottery-state')),
  ]);
  const member = membership[0];
  const boat = member ? (await db.select().from(schema.partyBoats).where(eq(schema.partyBoats.id, member.boatId)))[0] : null;
  const lightUntil = typeof (lighthouseSetting[0]?.value as any)?.litUntil === 'string' ? new Date((lighthouseSetting[0].value as any).litUntil) : null;
  const lighthouseLit = !!lightUntil && lightUntil > new Date();
  const fishingEntitlement = entitlements.find((item) => item.productId === 'unlimited-online-fishing' && item.isActive && !!item.endsAt && item.endsAt > new Date());
  return {
    dailyHarvest,
    customStatistics: null,
    latestMarketTradeAt: null,
    latestMarketFishTradeAt: null,
    latestMarketGearTradeAt: null,
    latestMarketItemTradeAt: null,
    latestTournamentParticipationAt: null,
    tournamentHistoryViewedAt: null,
    pendingGuildApplicationCount: await countPendingGuildApps(playerId),
    onlinePlayerCount: Number(onlineCount[0]?.count ?? 1),
    nextDailyHarvestResetAt: nextChinaMidnight().toISOString(),
    activeBuffs: await activeBuffsFor(playerId),
    nextBuffBoundaryAt: null,
    arcaneSacrifice: await arcaneSacrificeState(),
    globalNotification: await currentGlobalNotification(),
    guildBiomeBoosts: [],
    party: {
      isInParty: !!boat,
      role: member?.role ?? null,
      canChangeBoatBiome: member?.role === 'captain' || member?.role === 'helm',
      status: boat?.status ?? null,
      source: boat ? (boat.isPermanent ? 'owned' : 'rented') : null,
      boatDefinitionId: boat?.boatDefinitionId ?? null,
      boatName: boat?.name ?? null,
      visibility: boat?.visibility ?? null,
      boatBiomeId: boat?.biomeId ?? null,
      rentalEndsAt: boat?.rentalEndsAt?.toISOString() ?? null,
      maintenanceDueAt: boat?.maintenanceDueAt?.toISOString() ?? null,
    },
    unlimitedOnlineFishing: { isActive: !!fishingEntitlement || lighthouseLit, endsAt: lighthouseLit ? lightUntil!.toISOString() : fishingEntitlement?.endsAt?.toISOString() ?? null },
  };
}

async function countPendingGuildApps(playerId: string) {
  const guildIds = await db.select({ guildId: schema.guildMembers.guildId }).from(schema.guildMembers).where(eq(schema.guildMembers.playerId, playerId));
  if (!guildIds.length) return 0;
  let count = 0;
  for (const g of guildIds) {
    const rows = await db.select().from(schema.guildApplications).where(and(
      eq(schema.guildApplications.guildId, g.guildId),
      eq(schema.guildApplications.status, 'pending'),
    ));
    count += rows.length;
  }
  return count;
}

async function activeBuffsFor(playerId: string) {
  const [playerBuffs, globalBuffs] = await Promise.all([
    db.select().from(schema.playerBuffs).where(and(eq(schema.playerBuffs.playerId, playerId), sql`${schema.playerBuffs.endsAt} > now()`)),
    db.select().from(schema.globalBuffs).where(sql`${schema.globalBuffs.endsAt} > now()`),
  ]);
  const out: any[] = [];
  for (const b of playerBuffs) {
    out.push({
      id: b.id,
      source: b.source,
      buffType: b.buffType,
      displayTag: displayTag(b.buffType, b.bonusBasisPoints),
      displayDescription: `个人${displayTag(b.buffType, b.bonusBasisPoints)}`,
      bonusBasisPoints: b.bonusBasisPoints,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      status: 'active',
      purchaser: null,
    });
  }
  for (const b of globalBuffs) {
    out.push({
      id: b.id,
      source: 'player_shop',
      buffType: b.buffType,
      displayTag: displayTag(b.buffType, b.bonusBasisPoints),
      displayDescription: `玩家购买的全服${displayTag(b.buffType, b.bonusBasisPoints)}`,
      bonusBasisPoints: b.bonusBasisPoints,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      status: 'active',
      purchaser: null,
    });
  }
  return out;
}

function displayTag(buffType: string, bp: number): string {
  const names: Record<string, string> = {
    experience: '经验', gold: '金币', strength: '力量', intelligence: '智力', luck: '运气', endurance: '耐力',
  };
  const sign = bp >= 0 ? '+' : '';
  return `${names[buffType] ?? buffType} ${sign}${bp / 100}%`;
}

async function arcaneSacrificeState() {
  const today = chinaDate();
  const rounds = await db.select().from(schema.arcaneSacrificeRounds)
    .where(eq(schema.arcaneSacrificeRounds.dayDate, today)).orderBy(schema.arcaneSacrificeRounds.roundNumber);
  const completed = rounds.filter((r) => r.status === 'completed');
  const current = rounds.find((r) => r.status === 'open');
  const surge = completed[completed.length - 1];
  const nextTypes = ['fish', 'gold', 'relic'];
  return {
    resourceType: current?.resourceType ?? null,
    nextResourceType: current ? null : nextTypes[completed.length % 3],
    roundNumber: current?.roundNumber ?? null,
    completedRounds: completed.length,
    target: current?.target ?? null,
    progress: current?.progress ?? 0,
    opensAt: current?.opensAt.toISOString() ?? null,
    surge: surge && surge.effectEndsAt && surge.effectEndsAt > new Date()
      ? { isActive: true, startedAt: surge.completedAt?.toISOString(), endsAt: surge.effectEndsAt.toISOString(), nextBoundaryAt: surge.effectEndsAt.toISOString() }
      : { isActive: false, startedAt: null, endsAt: null, nextBoundaryAt: null },
  };
}

async function currentGlobalNotification() {
  const rows = await db.select().from(schema.globalNotifications).where(sql`${schema.globalNotifications.endsAt} > now()`).orderBy(desc(schema.globalNotifications.startsAt)).limit(1);
  if (!rows.length) return null;
  const n = rows[0];
  const player = (await db.select().from(schema.players).where(eq(schema.players.id, n.playerId)))[0];
  const fishRow = n.fishId ? (await db.select().from(schema.fish).where(eq(schema.fish.id, n.fishId)))[0] : null;
  return {
    id: n.id,
    kind: n.kind,
    startsAt: n.startsAt.toISOString(),
    endsAt: n.endsAt.toISOString(),
    identity: player ? {
      publicId: player.publicId,
      nickname: player.nickname,
      guildTag: null,
      level: player.level,
      avatar: { id: 'moonfall-scout', name: '溪谷巡游者', imagePath: '/fish/b_001_common_01.webp', isActive: true },
      equippedTitle: null,
      nameStyle: { mode: 'default' },
    } : null,
    fish: fishRow ? { id: fishRow.id, name: fishRow.name, biomeId: fishRow.biomeId, biomeName: biomeNameOf(fishRow.biomeId), rarity: fishRow.rarity } : null,
    quantity: n.quantity,
    caughtAt: n.startsAt.toISOString(),
  };
}

const biomeNameCache = new Map<string, string>();
async function biomeNameOf(id: string): Promise<string> {
  if (biomeNameCache.has(id)) return biomeNameCache.get(id)!;
  const row = (await db.select().from(schema.biomes).where(eq(schema.biomes.id, id)))[0];
  const name = row?.name ?? id;
  biomeNameCache.set(id, name);
  return name;
}

function nextChinaMidnight(): Date {
  const now = new Date();
  const china = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const midnight = new Date(Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate() + 1, 0, 0, 0));
  return new Date(midnight.getTime() - 8 * 60 * 60 * 1000);
}

function summarizeSettlement(results: any[], mode: 'online' | 'offline') {
  const fish = new Map<string, { fishId: string; name: string; rarity: string; quantity: number }>();
  const gear: any[] = [];
  const chests: any[] = [];
  let gold = 0, experience = 0, relics = 0;
  for (const result of results) {
    gold += result.gold ?? 0;
    experience += result.experience ?? 0;
    relics += result.relics ?? 0;
    if (result.fishId) {
      const entry = fish.get(result.fishId) ?? { fishId: result.fishId, name: result.name ?? '', rarity: result.rarity ?? 'common', quantity: 0 };
      entry.quantity += result.quantity ?? 1;
      fish.set(result.fishId, entry);
    }
    if (result.gearId) gear.push({ id: result.gearId, name: result.name ?? '装备' });
    if (result.chests > 0) chests.push({ id: 'chest', quantity: result.chests });
  }
  return {
    mode, castsResolved: results.length, gold, directGoldGross: gold, guildTaxGold: 0,
    directGoldNet: gold, nonTaxableGold: 0, experience, partyBonusExperience: 0,
    minimumEffectiveCrewCount: 1, maximumEffectiveCrewCount: 1,
    fish: [...fish.values()], gear, chests, bonusItems: [], relics,
    baitConsumed: [], recentResults: results, appliedBuffs: [],
  };
}

function emptySummary() {
  return {
    casts: 0, fishQuantity: 0, gold: 0, directGoldGross: 0, guildTaxGold: 0,
    directGoldNet: 0, nonTaxableGold: 0, experience: 0, partyBonusExperience: 0,
  };
}

async function buildFishingState(playerId: string, run: any, settlementOverride?: any) {
  const extras = await fishingExtras(playerId);
  const playerRow = (await db.select().from(schema.players).where(eq(schema.players.id, playerId)))[0];
  const results: any[] = run?.results ?? [];
  const lastResult = results[results.length - 1] ?? null;
  return {
    run: run ? {
      id: run.id,
      status: run.status,
      mode: run.mode,
      remainingCasts: run.remainingCasts,
      totalCasts: run.totalCasts,
      cycleDurationMs: run.cycleDurationMs ?? 6000,
      biomeId: run.biomeId,
      startedAt: run.startedAt?.toISOString?.() ?? run.startedAt ?? null,
      lastSyncAt: run.lastSyncAt?.toISOString?.() ?? run.lastSyncAt ?? null,
      nextCastAt: run.nextCastAt?.toISOString() ?? null,
      effects: run.effects ?? {
        mapMasteryLevel: 0, mapXpBonusBasisPoints: 0, globalXpBonusBasisPoints: 0,
        mapDirectGoldBonusBasisPoints: 0, guild: null,
      },
      stats: run.snapshot?.stats ?? null,
      snapshotKey: `v1:${run.snapshotKey ?? 'A0'}`,
      snapshot: run.snapshot,
    } : null,
    lastResult,
    batchSummary: run ? {
      casts: (run.results ?? []).length,
      gold: run.batchGold,
      fishQuantity: run.batchFishQuantity,
      guildTaxGold: run.guildTaxGold,
      directGoldNet: run.batchGold,
      nonTaxableGold: 0,
      directGoldGross: run.batchGold,
      partyBonusExperience: run.partyBonusExperience,
      experience: run.batchExperience,
    } : emptySummary(),
    ...extras,
    unlimitedOnlineFishing: extras.unlimitedOnlineFishing,
    routeAssistant: null,
    settlement: settlementOverride ?? {
      mode: run?.mode ?? 'online',
      castsResolved: 0,
      gold: 0,
      directGoldGross: 0,
      guildTaxGold: 0,
      directGoldNet: 0,
      nonTaxableGold: 0,
      experience: 0,
      partyBonusExperience: 0,
      minimumEffectiveCrewCount: 1,
      maximumEffectiveCrewCount: 1,
      fish: [],
      gear: [],
      chests: [],
      bonusItems: [],
      relics: 0,
      baitConsumed: [],
      recentResults: run?.results ?? [],
      appliedBuffs: [],
    },
    partyTravelNotice: null,
    playerPatch: playerRow ? {
      id: playerRow.id, level: playerRow.level, experience: playerRow.experience,
      experienceToNextLevel: LEVEL_EXP_FORMULA(playerRow.level), gold: playerRow.gold,
      relics: playerRow.relics, fragments: playerRow.fragments, unspentStatPoints: playerRow.unspentStatPoints,
      currentBiomeId: playerRow.currentBiomeId, selectedBaitId: playerRow.selectedBaitId,
      equippedRodId: playerRow.equippedRodId, marketAccessStatus: playerRow.marketAccessStatus,
      goldPenaltyTotal: playerRow.goldPenaltyTotal,
      acknowledgedGoldPenaltyTotal: playerRow.acknowledgedGoldPenaltyTotal,
    } : null,
    serverTime: new Date().toISOString(),
  };
}
