import { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { eq, and, sql, desc } from 'drizzle-orm';
import { requireAuth } from '../services/auth.js';
import { chinaDate } from './auth.js';

export const LEADERBOARD_CATEGORIES = [
  'level', 'gold_balance', 'relic_balance', 'fishing_gold', 'npc_fish_sold_gold', 'fishing_relics',
  'attribute:strength', 'attribute:intelligence', 'attribute:luck', 'attribute:endurance',
  'total_casts', 'online_casts', 'offline_casts', 'total_fish_caught', 'npc_fish_sold_quantity',
  'chests_dropped', 'gear_dropped', 'discovered_fish',
];

export async function registerLeaderboardsRoutes(app: FastifyInstance) {
  app.get('/api/leaderboards/dates', async (req, reply) => {
    const today = chinaDate();
    const dates: string[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(Date.now() - i * 86400000);
      const p = (n: number) => String(n).padStart(2, '0');
      const china = new Date(d.getTime() + 8 * 3600 * 1000);
      dates.push(`${china.getUTCFullYear()}-${p(china.getUTCMonth() + 1)}-${p(china.getUTCDate())}`);
    }
    return { currentDate: today, dates, serverTime: new Date().toISOString() };
  });

  app.get('/api/leaderboards', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const q = req.query as any;
    const category = String(q.category ?? 'level');
    const date = String(q.date ?? chinaDate());
    const limit = Math.min(100, Number(q.limit ?? 50));

    const isHistorical = date !== chinaDate();
    const snapshot = isHistorical
      ? (await db.select().from(schema.leaderboardSnapshots).where(and(
          eq(schema.leaderboardSnapshots.category, category), eq(schema.leaderboardSnapshots.date, date),
        )))[0]
      : null;

    let entries: Array<{ playerId: string; value: number; secondaryValue?: number }> = [];
    if (snapshot) {
      entries = snapshot.entries as any;
    } else {
      const rows = await computeLeaderboard(category, limit * 3);
      entries = rows;
    }

    // real identity data
    const players = await db.select().from(schema.players);
    const pMap = new Map(players.map((p) => [p.id, p]));
    const avatars = await db.select().from(schema.avatars);
    const avatarMap = new Map(avatars.map((a) => [a.id, a]));
    const titles = await db.select().from(schema.titles);
    const titleMap = new Map(titles.map((t) => [t.id, t]));
    const guildMembers = await db.select().from(schema.guildMembers);
    const guilds = await db.select().from(schema.guilds);
    const guildMap = new Map(guilds.map((g) => [g.id, g]));
    const guildTagByPlayer = new Map<string, string | null>();
    for (const gm of guildMembers) {
      const g = guildMap.get(gm.guildId);
      if (g && !guildTagByPlayer.has(gm.playerId)) guildTagByPlayer.set(gm.playerId, g.tag);
    }

    const identityOf = (pid: string) => {
      const p = pMap.get(pid);
      if (!p) return null;
      const avatar = avatarMap.get(p.avatarId);
      const title = p.equippedTitleId ? titleMap.get(p.equippedTitleId) : null;
      return {
        publicId: p.publicId,
        nickname: p.nickname,
        guildTag: guildTagByPlayer.get(pid) ?? null,
        level: p.level,
        avatar: avatar ? { id: avatar.id, name: avatar.name, imagePath: avatar.imagePath, isActive: true } : { id: 'moonfall-scout', name: '溪谷巡游者', imagePath: '/fish/b_001_common_01.webp', isActive: true },
        equippedTitle: title ? { id: title.id, name: title.name, imagePath: title.imagePath, description: title.description, style: title.textColor ? { textColor: title.textColor, backgroundColor: title.backgroundColor, borderColor: title.borderColor, borderEffect: title.borderEffect } : undefined } : null,
        nameStyle: { mode: p.nameStyleMode, colors: p.nameStyleColors ?? [], angle: p.nameStyleAngle ?? undefined },
      };
    };

    const top100 = entries.slice(0, limit).map((e, i) => ({
      category,
      value: e.value,
      rank: i + 1,
      secondaryValue: e.secondaryValue ?? 0,
      position: i + 1,
      identity: identityOf(e.playerId),
      isCurrentPlayer: e.playerId === player.id,
    }));

    const myIndex = entries.findIndex((e) => e.playerId === player.id);
    return {
      status: 'ready',
      date,
      category,
      isHistorical,
      generatedAt: new Date().toISOString(),
      nextRefreshAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      entries: top100,
      currentPlayer: myIndex >= 0 ? {
        category,
        value: entries[myIndex].value,
        rank: myIndex + 1,
        secondaryValue: entries[myIndex].secondaryValue ?? 0,
        position: myIndex + 1,
        identity: identityOf(player.id),
        isCurrentPlayer: true,
      } : {
        category, value: null, rank: null, isTop100: false,
        identity: identityOf(player.id),
        isCurrentPlayer: true,
      },
      serverTime: new Date().toISOString(),
    };
  });
}

export async function computeLeaderboard(category: string, limit: number): Promise<Array<{ playerId: string; value: number; secondaryValue?: number }>> {
  if (category === 'level') {
    const rows = await db.select({
      playerId: schema.players.id,
      value: schema.players.level,
      secondaryValue: schema.players.experience,
    }).from(schema.players).orderBy(desc(schema.players.level), desc(schema.players.experience)).limit(limit);
    return rows;
  }
  if (category === 'gold_balance') {
    const rows = await db.select({ playerId: schema.players.id, value: schema.players.gold }).from(schema.players).orderBy(desc(schema.players.gold)).limit(limit);
    return rows;
  }
  if (category === 'relic_balance') {
    const rows = await db.select({ playerId: schema.players.id, value: schema.players.relics }).from(schema.players).orderBy(desc(schema.players.relics)).limit(limit);
    return rows;
  }
  if (category === 'fishing_gold') {
    const rows = await db.select({
      playerId: schema.players.id,
      value: sql<number>`(select coalesce(sum(batch_gold), 0) from fishing_runs fr where fr.player_id = players.id)::bigint`,
    }).from(schema.players).orderBy(desc(sql`(select coalesce(sum(batch_gold), 0) from fishing_runs fr where fr.player_id = players.id)`)).limit(limit);
    return rows;
  }
  if (category === 'npc_fish_sold_gold') {
    const rows = await db.select({ playerId: schema.players.id, value: schema.players.npcFishSoldGold }).from(schema.players).orderBy(desc(schema.players.npcFishSoldGold)).limit(limit);
    return rows;
  }
  if (category === 'fishing_relics') {
    const rows = await db.select({ playerId: schema.players.id, value: schema.players.totalRelicQuantity }).from(schema.players).orderBy(desc(schema.players.totalRelicQuantity)).limit(limit);
    return rows;
  }
  if (category.startsWith('attribute:')) {
    const attr = category.split(':')[1];
    const colMap: Record<string, any> = {
      strength: schema.players.baseStrength, intelligence: schema.players.baseIntelligence,
      luck: schema.players.baseLuck, endurance: schema.players.baseEndurance,
    };
    const col = colMap[attr];
    if (!col) return [];
    const rows = await db.select({ playerId: schema.players.id, value: col }).from(schema.players).orderBy(desc(col)).limit(limit);
    return rows;
  }
  if (category === 'total_casts') {
    const rows = await db.select({ playerId: schema.players.id, value: schema.players.totalCasts }).from(schema.players).orderBy(desc(schema.players.totalCasts)).limit(limit);
    return rows;
  }
  if (category === 'online_casts' || category === 'offline_casts') {
    const col = category === 'online_casts' ? schema.playerStats.onlineCasts : schema.playerStats.offlineCasts;
    const rows = await db.select({
      playerId: schema.playerStats.playerId,
      value: col,
    }).from(schema.playerStats).orderBy(desc(col)).limit(limit);
    return rows;
  }
  if (category === 'total_fish_caught') {
    const rows = await db.select({ playerId: schema.players.id, value: schema.players.totalFishCaught }).from(schema.players).orderBy(desc(schema.players.totalFishCaught)).limit(limit);
    return rows;
  }
  if (category === 'npc_fish_sold_quantity') {
    const rows = await db.select({ playerId: schema.players.id, value: schema.players.npcFishSoldQuantity }).from(schema.players).orderBy(desc(schema.players.npcFishSoldQuantity)).limit(limit);
    return rows;
  }
  if (category === 'chests_dropped') {
    const rows = await db.select({ playerId: schema.players.id, value: schema.players.totalChestsDropped }).from(schema.players).orderBy(desc(schema.players.totalChestsDropped)).limit(limit);
    return rows;
  }
  if (category === 'gear_dropped') {
    const rows = await db.select({ playerId: schema.players.id, value: schema.players.totalGearDropped }).from(schema.players).orderBy(desc(schema.players.totalGearDropped)).limit(limit);
    return rows;
  }
  if (category === 'discovered_fish') {
    const rows = await db.select({
      playerId: schema.players.id,
      value: sql<number>`(select count(*) from player_inventory_fish pif where pif.player_id = players.id and pif.total_caught > 0)::int`,
    }).from(schema.players).orderBy(desc(sql`(select count(*) from player_inventory_fish pif where pif.player_id = players.id and pif.total_caught > 0)`)).limit(limit);
    return rows;
  }
  const rows = await db.select({ playerId: schema.players.id, value: schema.players.level }).from(schema.players).orderBy(desc(schema.players.level)).limit(limit);
  return rows;
}
