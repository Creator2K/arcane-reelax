import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
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
