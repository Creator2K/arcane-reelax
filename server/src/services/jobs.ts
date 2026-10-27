import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { eq, desc, asc, sql } from 'drizzle-orm';
import { computeLeaderboard } from '../routes/leaderboards.js';

// Scheduled jobs: leaderboard snapshots, tournament finalization, event rotation.

function chinaDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const china = new Date(d.getTime() + 8 * 3600 * 1000);
  return `${china.getUTCFullYear()}-${p(china.getUTCMonth() + 1)}-${p(china.getUTCDate())}`;
}

async function regenerateLeaderboards() {
  const today = chinaDate();
  const categories = ['level', 'gold_balance', 'relic_balance', 'fishing_gold', 'npc_fish_sold_gold', 'fishing_relics', 'attribute:strength', 'attribute:intelligence', 'attribute:luck', 'attribute:endurance', 'total_casts', 'online_casts', 'offline_casts', 'total_fish_caught', 'npc_fish_sold_quantity', 'chests_dropped', 'gear_dropped', 'discovered_fish'];
  for (const category of categories) {
    const rows = await computeLeaderboard(category, 500);
    const entries = rows.map((r, i) => ({ playerId: r.playerId, rank: i + 1, value: Number(r.value), secondaryValue: Number((r as any).secondaryValue ?? 0) }));
    await db.insert(schema.leaderboardSnapshots).values({ category, date: today, generatedAt: new Date(), entries })
      .onConflictDoUpdate({ target: [schema.leaderboardSnapshots.category, schema.leaderboardSnapshots.date], set: { entries, generatedAt: new Date() } });
  }
  console.log('[job] leaderboards regenerated for', today);
}

async function generateScheduledTournaments() {
  const now = new Date();
  await db.update(schema.tournaments)
    .set({ status: 'active' })
    .where(sql`${schema.tournaments.status} = 'scheduled' AND ${schema.tournaments.startAt} <= now() AND ${schema.tournaments.endAt} > now()`);

  const [allTournaments, biomes, fish] = await Promise.all([
    db.select().from(schema.tournaments).orderBy(asc(schema.tournaments.sequence)),
    db.select().from(schema.biomes).orderBy(asc(schema.biomes.orderIndex)),
    db.select().from(schema.fish),
  ]);
  if (!biomes.length || !fish.length) return;
  const pointsByRarity: Record<string, number> = {
    common: 1, uncommon: 2, fine: 5, rare: 10, epic: 25,
    legendary: 50, mythic: 100, exotic: 250, arcane: 500,
  };
  const existing = new Set(allTournaments.map((item) => `${item.type}:${item.startAt.getTime()}`));
  const scheduledCount = { personal: 0, guild: 0 };
  for (const item of allTournaments) {
    if (item.status === 'scheduled' && item.startAt > now && (item.type === 'personal' || item.type === 'guild')) scheduledCount[item.type] += 1;
  }
  let sequence = allTournaments.reduce((max, item) => Math.max(max, item.sequence), 0);
  const schedules = {
    personal: [{ count: 8, hours: [10, 15] }],
    guild: [{ count: 4, hours: [20] }],
  } as const;

  for (const type of ['personal', 'guild'] as const) {
    const config = schedules[type][0];
    for (let dayOffset = 0; dayOffset < 21 && scheduledCount[type] < config.count; dayOffset += 1) {
      for (const chinaHour of config.hours) {
        if (scheduledCount[type] >= config.count) break;
        const startAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset, chinaHour - 8, 0, 0));
        const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
        if (startAt <= now) continue;
        const key = `${type}:${startAt.getTime()}`;
        if (existing.has(key)) continue;
        sequence += 1;
        const biome = biomes[(sequence * 7 + (type === 'guild' ? 3 : 0)) % biomes.length];
        const fishByRarity = new Map<string, typeof schema.fish.$inferSelect>();
        for (const fishDefinition of fish.filter((entry) => entry.biomeId === biome.id)) {
          if (!fishByRarity.has(fishDefinition.rarity)) fishByRarity.set(fishDefinition.rarity, fishDefinition);
        }
        const targets = [...fishByRarity.entries()]
          .sort(([left], [right]) => ['common', 'uncommon', 'fine', 'rare', 'epic', 'legendary', 'mythic', 'exotic', 'arcane'].indexOf(left) - ['common', 'uncommon', 'fine', 'rare', 'epic', 'legendary', 'mythic', 'exotic', 'arcane'].indexOf(right))
          .map(([rarity, entry]) => ({ fishId: entry.id, rarity, pointsPerFish: pointsByRarity[rarity] ?? 1 }));
        await db.insert(schema.tournaments).values({
          type,
          sequence,
          status: 'scheduled',
          biomeId: biome.id,
          startAt,
          endAt,
          minimumGuilds: type === 'guild' ? 2 : 1,
          targets,
        });
        existing.add(key);
        scheduledCount[type] += 1;
      }
    }
  }
  console.log('[job] tournament schedule ready', scheduledCount);
}

async function finalizeEndedTournaments() {
  const now = new Date();
  const ended = await db.select().from(schema.tournaments).where(sql`${schema.tournaments.status} = 'active' AND ${schema.tournaments.endAt} <= now()`);
  for (const t of ended) {
    // compute rankings
    const regs = await db.select().from(schema.tournamentRegistrations).where(eq(schema.tournamentRegistrations.tournamentId, t.id));
    const sorted = regs.sort((a, b) => Number(b.score) - Number(a.score));
    await db.transaction(async (tx) => {
      await tx.update(schema.tournaments).set({ status: 'completed' }).where(eq(schema.tournaments.id, t.id));
      for (let i = 0; i < sorted.length; i++) {
        await tx.update(schema.tournamentRegistrations).set({ rank: i + 1 }).where(eq(schema.tournamentRegistrations.id, sorted[i].id));
        if (i === 0 && t.type === 'personal') {
          // top1 gets a trophy? original awards medals/trophies; keep simple: mark participation stat
          await tx.update(schema.playerStats).set({ personalTournaments: sql`${schema.playerStats.personalTournaments} + 1` }).where(eq(schema.playerStats.playerId, sorted[i].playerId));
        }
      }
    });
    console.log('[job] tournament finalized:', t.id);
  }
}

async function rotateEvents() {
  // if no open round today and completed < 2, open next round
  const today = chinaDate();
  const rounds = await db.select().from(schema.arcaneSacrificeRounds).where(eq(schema.arcaneSacrificeRounds.dayDate, today)).orderBy(desc(schema.arcaneSacrificeRounds.roundNumber));
  const open = rounds.filter((r) => r.status === 'open');
  const completed = rounds.filter((r) => r.status === 'completed');
  if (open.length === 0 && completed.length < 2) {
    const nextTypes = ['fish', 'gold', 'relic'];
    const resourceType = nextTypes[completed.length % 3];
    const baseTargets: Record<string, number> = { fish: 4862900, gold: 185403000, relic: 250000 };
    await db.insert(schema.arcaneSacrificeRounds).values({
      dayDate: today,
      roundNumber: rounds.length + 1,
      cycleOrdinal: rounds.length + 1,
      resourceType,
      target: baseTargets[resourceType],
      progress: 0,
      status: 'open',
      opensAt: new Date(),
    });
    console.log('[job] sacrifice round opened:', resourceType);
  }
}

let started = false;

export function startScheduledJobs() {
  if (started) return;
  started = true;
  console.log('[jobs] scheduled jobs started');
  const run = async () => {
    try {
      await regenerateLeaderboards();
    } catch (e) { console.error('[job] leaderboard error', e); }
    try {
      await generateScheduledTournaments();
      await finalizeEndedTournaments();
    } catch (e) { console.error('[job] tournament error', e); }
    try {
      await rotateEvents();
    } catch (e) { console.error('[job] event error', e); }
  };
  // every 10 minutes
  setInterval(run, 10 * 60 * 1000);
  // run once shortly after boot
  setTimeout(run, 5000);
}
