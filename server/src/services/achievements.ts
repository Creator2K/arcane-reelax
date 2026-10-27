import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';

export async function syncAchievementProgress(playerId: string) {
  const [player, stats, weatherCasts, baitCasts, biomeCasts, progress, defs, inv, biomes, playerBiomes, mastery, rods, fishRows] = await Promise.all([
    db.select().from(schema.players).where(eq(schema.players.id, playerId)),
    db.select().from(schema.playerStats).where(eq(schema.playerStats.playerId, playerId)),
    db.select().from(schema.playerWeatherCasts).where(eq(schema.playerWeatherCasts.playerId, playerId)),
    db.select().from(schema.playerBaitCasts).where(eq(schema.playerBaitCasts.playerId, playerId)),
    db.select().from(schema.playerBiomeCasts).where(eq(schema.playerBiomeCasts.playerId, playerId)),
    db.select().from(schema.playerAchievements).where(eq(schema.playerAchievements.playerId, playerId)),
    db.select().from(schema.achievementDefinitions),
    db.select().from(schema.playerInventoryFish).where(eq(schema.playerInventoryFish.playerId, playerId)),
    db.select().from(schema.biomes),
    db.select().from(schema.playerBiomes).where(eq(schema.playerBiomes.playerId, playerId)),
    db.select().from(schema.playerMasteryProgress).where(eq(schema.playerMasteryProgress.playerId, playerId)),
    db.select().from(schema.playerRods).where(eq(schema.playerRods.playerId, playerId)),
    db.select().from(schema.fish),
  ]);

  const p = player[0];
  const s = stats[0];
  const fishDefs: any[] = fishRows ?? [];
  if (!p || !s) return;

  const wMap = new Map(weatherCasts.map((x) => [x.weatherId, x.casts]));
  const bMap = new Map(baitCasts.map((x) => [x.baitId, x.casts]));
  const bcMap = new Map(biomeCasts.map((x) => [x.biomeId, x.casts]));
  const invMap = new Map(inv.map((x) => [x.fishId, x]));
  const progMap = new Map(progress.map((x) => [x.achievementId, x]));
  const unlocked = new Map(playerBiomes.filter((x) => x.isUnlocked).map((x) => [x.biomeId, true]));
  const biomeDefMap = new Map(biomes.map((x) => [x.id, x]));
  const biomeTotalFish = new Map<string, number>();
  for (const f of fishDefs) {
    biomeTotalFish.set(f.biomeId, (biomeTotalFish.get(f.biomeId) ?? 0) + 1);
  }
  const discoveredByBiome = new Map<string, number>();
  for (const [fishId, rec] of invMap) {
    if ((rec?.totalCaught ?? 0) === 0) continue;
    const def = fishDefs.find((f) => f.id === fishId);
    if (def) discoveredByBiome.set(def.biomeId, (discoveredByBiome.get(def.biomeId) ?? 0) + 1);
  }

  const discoveredTotal = inv.filter((x) => x.totalCaught > 0).length;
  const masteryTotal = mastery.reduce((sum, m) => sum + (m.completedLevel ?? 0), 0);
  const rodTotalLevels = rods.reduce((sum, r) => sum + Math.max(0, r.level - 1), 0);

  const updates: Array<{ id: string; progress: number; status: string }> = [];

  for (const d of defs) {
    const rec = progMap.get(d.id);
    if (rec?.status === 'claimed') continue;
    const value = computeValue(d.id, {
      player: p, stats: s,
      weatherCasts: wMap, baitCasts: bMap, biomeCasts: bcMap,
      discoveredTotal, unlocked, biomeDefMap, biomeTotalFish, discoveredByBiome,
      masteryTotal, rodTotalLevels, invMap, gearUpgrades: p.totalGearUpgrades,
      marketTrades: s.marketTrades, npcSold: p.npcFishSoldQuantity,
      personalTournaments: s.personalTournaments, guildTournaments: s.guildTournaments,
      chestsOpened: p.totalChestsOpened, chestsDropped: p.totalChestsDropped,
      gearDropped: p.totalGearDropped, relics: p.totalRelicQuantity,
      onlineCasts: s.onlineCasts, offlineCasts: s.offlineCasts,
      loginDays: s.loginDays,
    });
    if (!rec) {
      // insert fresh
      const status = value >= d.threshold ? 'claimable' : 'in_progress';
      await db.insert(schema.playerAchievements).values({
        playerId, achievementId: d.id, progress: Math.min(value, d.threshold), status,
      }).onConflictDoNothing();
    } else if (value > rec.progress || (value >= d.threshold && rec.status === 'in_progress')) {
      const status = value >= d.threshold ? 'claimable' : 'in_progress';
      await db.update(schema.playerAchievements).set({
        progress: Math.min(value, d.threshold),
        status,
      }).where(and(eq(schema.playerAchievements.playerId, playerId), eq(schema.playerAchievements.achievementId, d.id)));
    }
  }
  return updates;
}

interface Ctx {
  player: typeof schema.players.$inferSelect;
  stats: typeof schema.playerStats.$inferSelect;
  weatherCasts: Map<string, number>;
  baitCasts: Map<string, number>;
  biomeCasts: Map<string, number>;
  discoveredTotal: number;
  unlocked: Map<string, boolean>;
  biomeDefMap: Map<string, typeof schema.biomes.$inferSelect>;
  biomeTotalFish: Map<string, number>;
  discoveredByBiome: Map<string, number>;
  masteryTotal: number;
  rodTotalLevels: number;
  invMap: Map<string, { quantity: number; totalCaught: number }>;
  gearUpgrades: number;
  marketTrades: number;
  npcSold: number;
  personalTournaments: number;
  guildTournaments: number;
  chestsOpened: number;
  chestsDropped: number;
  gearDropped: number;
  relics: number;
  onlineCasts: number;
  offlineCasts: number;
  loginDays: number;
}

function computeValue(id: string, c: Ctx): number {
  const p = c.player;
  // simple patterns
  let m = id.match(/^casts_(\d+)$/); if (m) return p.totalCasts;
  m = id.match(/^level_(\d+)$/); if (m) return p.level;
  m = id.match(/^fish_(\d+)$/); if (m) return p.totalFishCaught;
  m = id.match(/^login_days_(\d+)$/); if (m) return c.loginDays;
  m = id.match(/^discover_(\d+)$/); if (m) return c.discoveredTotal;
  m = id.match(/^npc_sell_(\d+)$/); if (m) return c.npcSold;
  m = id.match(/^online_casts_(\d+)$/); if (m) return c.onlineCasts;
  m = id.match(/^offline_casts_(\d+)$/); if (m) return c.offlineCasts;
  m = id.match(/^fishing_relics_(\d+)$/); if (m) return c.relics;
  m = id.match(/^chests_dropped_(\d+)$/); if (m) return c.chestsDropped;
  m = id.match(/^gear_dropped_(\d+)$/); if (m) return c.gearDropped;
  m = id.match(/^chests_opened_(\d+)$/); if (m) return c.chestsOpened;
  m = id.match(/^gear_upgrade_(\d+)$/); if (m) return c.gearUpgrades;
  m = id.match(/^market_trade_(\d+)$/); if (m) return c.marketTrades;
  m = id.match(/^personal_tournaments_(\d+)$/); if (m) return c.personalTournaments;
  m = id.match(/^guild_tournaments_(\d+)$/); if (m) return c.guildTournaments;
  m = id.match(/^mastery_(\d+)$/); if (m) return c.masteryTotal;
  m = id.match(/^rod_level_(\d+)$/); if (m) return c.rodTotalLevels;
  m = id.match(/^biomes_(\d+)$/); if (m) return c.unlocked.size;
  m = id.match(/^weather_(\w+)_casts_(\d+)$/); if (m) return c.weatherCasts.get(m[1]) ?? 0;
  m = id.match(/^bait_(\w+)_casts_(\d+)$/); if (m) {
    const baitId = 'bait_' + m[1].replace('_', '');
    return c.baitCasts.get(baitId) ?? 0;
  }
  m = id.match(/^biome_b_(\d+)_casts_(\d+)$/); if (m) return c.biomeCasts.get('b_' + m[1]) ?? 0;
  m = id.match(/^biome_b_(\d+)_collection_(\d+)$/); if (m) return c.discoveredByBiome.get('b_' + m[1]) ?? 0;
  m = id.match(/^first_(legendary|mythic|exotic|arcane)$/); if (m) {
    const key = ('first' + m[1][0].toUpperCase() + m[1].slice(1) + 'At') as 'firstLegendaryAt';
    return c.stats[key] ? 1 : 0;
  }
  // special ids
  switch (id) {
    case 'capital_has_entered': return 1;
    case 'add_chicken_leg': return c.stats.marketTrades * 0 + (c.stats.loginDays > 0 ? 1 : 0);
    case 'angel_round_arrived': return c.stats.marketTrades > 0 ? 1 : 0;
    case 'worldline_maintainer': return c.stats.rodLevelsGained > 0 ? 1 : 0;
    case 'powering_with_love': return c.stats.loginDays >= 7 ? 1 : 0;
    case 'lucky_emperors_wish': return c.invMap.size > 0 ? 1 : 0;
    case 'pioneer_glory': return 1;
    case 'moonfall_complete': return (c.discoveredByBiome.get('b_001') ?? 0) >= (c.biomeTotalFish.get('b_001') ?? 66) ? 1 : 0;
    case 'all_biomes_complete': {
      let complete = true;
      for (const [biomeId, total] of c.biomeTotalFish) {
        if ((c.discoveredByBiome.get(biomeId) ?? 0) < total) { complete = false; break; }
      }
      return complete ? 1 : 0;
    }
    default: return 0;
  }
}
