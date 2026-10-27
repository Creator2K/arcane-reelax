import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { eq, and, sql, desc, asc } from 'drizzle-orm';
import { requireAuth } from '../services/auth.js';
import { AppError } from '../util/errors.js';
import { chinaDate } from './auth.js';

export async function registerCompetitionRoutes(app: FastifyInstance) {
  app.get('/api/tournaments/overview', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const now = new Date();
    const [current, upcoming, registrations, biomes, fish, playerBiomes] = await Promise.all([
      db.select().from(schema.tournaments).where(sql`${schema.tournaments.type} = 'personal' AND ${schema.tournaments.status} = 'active'`).orderBy(desc(schema.tournaments.startAt)).limit(1),
      db.select().from(schema.tournaments).where(sql`${schema.tournaments.type} = 'personal' AND ${schema.tournaments.status} = 'scheduled' AND ${schema.tournaments.startAt} > now()`).orderBy(asc(schema.tournaments.startAt)).limit(5),
      db.select().from(schema.tournamentRegistrations).where(eq(schema.tournamentRegistrations.playerId, player.id)),
      db.select().from(schema.biomes),
      db.select().from(schema.fish),
      db.select().from(schema.playerBiomes).where(eq(schema.playerBiomes.playerId, player.id)),
    ]);
    const unlockedBiomes = new Set(playerBiomes.filter((item) => item.isUnlocked).map((item) => item.biomeId));
    const biomeMap = new Map(biomes.map((b) => [b.id, b]));
    const fishMap = new Map(fish.map((f) => [f.id, f]));

    const currentOut = current[0] ? await tournamentPublic(current[0], registrations.filter((r) => r.tournamentId === current[0].id), biomeMap, fishMap, unlockedBiomes.has(current[0].biomeId)) : null;
    const upcomingOut = [];
    for (const t of upcoming) {
      upcomingOut.push(await tournamentPublic(t, registrations.filter((r) => r.tournamentId === t.id), biomeMap, fishMap, unlockedBiomes.has(t.biomeId)));
    }
    return { current: currentOut, upcoming: upcomingOut, recentResult: null, serverTime: now.toISOString() };
  });

  app.post('/api/tournaments/register-all', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const upcoming = await db.select().from(schema.tournaments).where(sql`${schema.tournaments.type} = 'personal' AND ${schema.tournaments.status} = 'scheduled' AND ${schema.tournaments.startAt} > now()`).orderBy(asc(schema.tournaments.startAt)).limit(5);
    const biomes = await db.select().from(schema.playerBiomes).where(eq(schema.playerBiomes.playerId, player.id));
    const unlocked = new Set(biomes.filter((b) => b.isUnlocked).map((b) => b.biomeId));
    let count = 0;
    for (const t of upcoming) {
      if (!unlocked.has(t.biomeId)) continue;
      const existing = await db.select().from(schema.tournamentRegistrations).where(and(
        eq(schema.tournamentRegistrations.tournamentId, t.id), eq(schema.tournamentRegistrations.playerId, player.id),
      ));
      if (existing.length) continue;
      const groupId = groupForLevel(player.level);
      await db.insert(schema.tournamentRegistrations).values({
        tournamentId: t.id, playerId: player.id, groupId, score: 0,
      });
      count += 1;
    }
    return { success: true, registeredCount: count };
  });

  app.get('/api/guild-tournaments/overview', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const [current, upcoming, guilds] = await Promise.all([
      db.select().from(schema.tournaments).where(sql`${schema.tournaments.type} = 'guild' AND ${schema.tournaments.status} = 'active'`),
      db.select().from(schema.tournaments).where(sql`${schema.tournaments.type} = 'guild' AND ${schema.tournaments.status} = 'scheduled' AND ${schema.tournaments.startAt} > now()`).orderBy(asc(schema.tournaments.startAt)).limit(5),
      db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id)),
    ]);
    const myGuild = guilds[0];
    const biomeMap = new Map((await db.select().from(schema.biomes)).map((b) => [b.id, b]));
    const fishMap = new Map((await db.select().from(schema.fish)).map((f) => [f.id, f]));
    const currentOut = current[0] ? await tournamentPublic(current[0], [], biomeMap, fishMap) : null;
    const upcomingOut = [];
    for (const t of upcoming) {
      const g = myGuild ? (await db.select().from(schema.tournamentRegistrations).where(and(
        eq(schema.tournamentRegistrations.tournamentId, t.id), eq(schema.tournamentRegistrations.guildId, myGuild.guildId),
      )))[0] : undefined;
      upcomingOut.push({
        ...await tournamentPublic(t, [], biomeMap, fishMap),
        entryStatus: g ? 'registered' : 'not_registered',
        canRegister: !!myGuild,
        guildScore: g?.score ?? 0,
        guildRank: g?.rank ?? null,
        memberContribution: 0,
      });
    }
    return { current: currentOut, upcoming: upcomingOut, recentResult: null, serverTime: new Date().toISOString() };
  });

  app.post('/api/tournaments/:tournamentId/register', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const tournamentId = String((req.params as any).tournamentId);
    const t = (await db.select().from(schema.tournaments).where(eq(schema.tournaments.id, tournamentId)))[0];
    if (!t) throw new AppError('TOURNAMENT_NOT_FOUND', '赛事不存在。');
    const pb = (await db.select().from(schema.playerBiomes).where(and(
      eq(schema.playerBiomes.playerId, player.id), eq(schema.playerBiomes.biomeId, t.biomeId),
    )))[0];
    if (!pb?.isUnlocked) throw new AppError('BIOME_LOCKED', '比赛地图未解锁。');
    const existing = await db.select().from(schema.tournamentRegistrations).where(and(
      eq(schema.tournamentRegistrations.tournamentId, tournamentId), eq(schema.tournamentRegistrations.playerId, player.id),
    ));
    if (existing.length) throw new AppError('ALREADY_REGISTERED', '已报名该赛事。');
    await db.insert(schema.tournamentRegistrations).values({
      tournamentId, playerId: player.id, groupId: groupForLevel(player.level), score: 0,
    });
    return { success: true };
  });

  app.post('/api/tournaments/:tournamentId/unregister', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const tournamentId = String((req.params as any).tournamentId);
    await db.delete(schema.tournamentRegistrations).where(and(
      eq(schema.tournamentRegistrations.tournamentId, tournamentId), eq(schema.tournamentRegistrations.playerId, player.id),
    ));
    return { success: true };
  });

  app.get('/api/tournaments/:tournamentId/leaderboard', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const tournamentId = String((req.params as any).tournamentId);
    const t = (await db.select().from(schema.tournaments).where(eq(schema.tournaments.id, tournamentId)))[0];
    if (!t) throw new AppError('TOURNAMENT_NOT_FOUND', '赛事不存在。');
    const [regs, players] = await Promise.all([
      db.select().from(schema.tournamentRegistrations).where(eq(schema.tournamentRegistrations.tournamentId, tournamentId)),
      db.select().from(schema.players),
    ]);
    const pMap = new Map(players.map((p) => [p.id, p]));
    const sorted = regs.sort((a, b) => Number(b.score) - Number(a.score));
    return {
      entries: sorted.slice(0, 100).map((r, i) => {
        const p = pMap.get(r.playerId);
        return {
          rank: i + 1,
          playerId: r.playerId,
          nickname: p?.nickname ?? '未知',
          publicId: p?.publicId ?? 0,
          level: p?.level ?? 0,
          groupId: r.groupId,
          score: r.score,
          isCurrentPlayer: r.playerId === player.id,
        };
      }),
      currentPlayer: sorted.find((r) => r.playerId === player.id)
        ? { rank: sorted.indexOf(sorted.find((r) => r.playerId === player.id)!) + 1, score: sorted.find((r) => r.playerId === player.id)!.score }
        : null,
      serverTime: new Date().toISOString(),
    };
  });

  app.get('/api/tournaments/history', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const rows = await db.select().from(schema.tournamentRegistrations).where(eq(schema.tournamentRegistrations.playerId, player.id)).orderBy(desc(schema.tournamentRegistrations.registeredAt)).limit(50);
    const tournaments = await db.select().from(schema.tournaments);
    const tMap = new Map(tournaments.map((t) => [t.id, t]));
    const biomeMap = new Map((await db.select().from(schema.biomes)).map((b) => [b.id, b]));
    return {
      items: rows.map((r) => {
        const t = tMap.get(r.tournamentId);
        return {
          id: r.id,
          tournamentId: r.tournamentId,
          type: t?.type ?? 'personal',
          sequence: t?.sequence ?? 0,
          biomeId: t?.biomeId ?? '',
          biomeName: t ? biomeMap.get(t.biomeId)?.name ?? '' : '',
          groupId: r.groupId,
          score: r.score,
          rank: r.rank ?? null,
          registeredAt: r.registeredAt.toISOString(),
        };
      }),
    };
  });

  app.get('/api/tournaments/archive', async (req, reply) => {
    const limit = Math.min(30, Number((req.query as any).limit ?? 20));
    const page = Math.max(1, Number((req.query as any).page ?? 1));
    const rows = await db.select().from(schema.tournaments).where(eq(schema.tournaments.status, 'completed')).orderBy(desc(schema.tournaments.startAt)).limit(limit).offset((page - 1) * limit);
    const biomeMap = new Map((await db.select().from(schema.biomes)).map((b) => [b.id, b]));
    return {
      items: rows.map((t) => ({
        id: t.id, type: t.type, sequence: t.sequence, biomeId: t.biomeId,
        biomeName: biomeMap.get(t.biomeId)?.name ?? '', startAt: t.startAt.toISOString(), endAt: t.endAt.toISOString(),
      })),
    };
  });

  app.get('/api/tournaments/medals', async (req, reply) => {
    const player = await requireAuth(req, reply);
    return { medals: [], counts: { gold: 0, silver: 0, bronze: 0, iron: 0, stone: 0, wood: 0 }, recent: [] };
  });

  app.get('/api/weekly-tournaments/overview', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const now = new Date();
    const weekStart = new Date(now.getTime() - ((now.getUTCDay() + 6) % 7) * 86400000);
    weekStart.setUTCHours(16, 0, 0, 0);
    const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
    const group = (await db.select().from(schema.weeklyTournamentGroups).where(eq(schema.weeklyTournamentGroups.playerId, player.id)).orderBy(desc(schema.weeklyTournamentGroups.createdAt)).limit(1))[0];
    return {
      state: group ? 'active' : 'not_eligible',
      launchAt: weekStart.toISOString(),
      current: {
        id: `weekly-${weekStart.getTime()}`,
        sequence: 1,
        status: 'active',
        startAt: weekStart.toISOString(),
        endAt: weekEnd.toISOString(),
        groupPublicId: group?.groupPublicId ?? null,
        ranking: [],
        me: null,
        projectedReward: null,
      },
      serverTime: now.toISOString(),
    };
  });

  app.get('/api/weekly-tournaments/medals', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const [medals, defs] = await Promise.all([
      db.select().from(schema.playerWeeklyMedals).where(eq(schema.playerWeeklyMedals.playerId, player.id)),
      db.select().from(schema.weeklyTournamentMedals).orderBy(schema.weeklyTournamentMedals.orderIndex),
    ]);
    const defMap = new Map(defs.map((m) => [m.id, m]));
    return {
      medals: medals.map((m) => ({ medalId: m.medalId, name: defMap.get(m.medalId)?.name ?? '', rank: m.rank, cycleSequence: m.cycleSequence, earnedAt: m.earnedAt.toISOString() })),
      rawStatBonus: 0,
      effectiveStatBonus: 0,
      statBonusCap: 0,
      recent: medals.slice(0, 5),
    };
  });

  app.get('/api/weekly-tournaments/shop', async (req, reply) => {
    const player = await requireAuth(req, reply);
    return weeklyShopState(player.id);
  });

  app.post('/api/weekly-tournaments/shop/purchases', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({ productId: z.string(), biomeId: z.string().optional() }).parse(req.body as any);
    const state = await weeklyShopState(player.id);
    const product = state.products.find((item) => item.id === body.productId);
    if (!product) throw new AppError('PRODUCT_NOT_FOUND', '周赛商店商品不存在。');
    if (product.availability === 'owned') throw new AppError('ALREADY_OWNED', '已经拥有该商品。');
    if (product.remainingLimit <= 0) throw new AppError('WEEKLY_LIMIT', '本周兑换次数已用完。');
    if (product.price > state.source.availablePoints) throw new AppError('INSUFFICIENT_POINTS', '可用周赛积分不足。');

    const stored = await loadWeeklyShopPurchaseState(player.id);
    let masteryResult: Record<string, unknown> | null = null;
    let rewardQuantity: number | null = null;
    let unlockedAvatarId: string | null = null;
    let unlockedTitleId: string | null = null;

    if (product.productType === 'avatar' && product.avatar) {
      await ensureWeeklyAvatars();
      const owned = await db.select().from(schema.playerAvatars).where(and(eq(schema.playerAvatars.playerId, player.id), eq(schema.playerAvatars.avatarId, product.avatar.id)));
      if (!owned.length) await db.insert(schema.playerAvatars).values({ playerId: player.id, avatarId: product.avatar.id });
      unlockedAvatarId = product.avatar.id;
    } else if (product.productType === 'title' && product.title) {
      await ensureWeeklyTitles();
      const row = (await db.select().from(schema.globalSettings).where(eq(schema.globalSettings.key, `player-lighthouse-titles:${player.id}`)))[0];
      const ids = Array.isArray(row?.value) ? row.value.filter((item): item is string => typeof item === 'string') : [];
      const next = [...new Set([...ids, product.title.id])];
      await db.insert(schema.globalSettings).values({ key: `player-lighthouse-titles:${player.id}`, value: next })
        .onConflictDoUpdate({ target: schema.globalSettings.key, set: { value: next, updatedAt: new Date() } });
      unlockedTitleId = product.title.id;
    } else if (product.productType === 'relics') {
      rewardQuantity = Number(product.rewardQuantity ?? 0);
      await db.update(schema.players).set({ relics: sql`${schema.players.relics} + ${rewardQuantity}` }).where(eq(schema.players.id, player.id));
    } else if (product.productType === 'fragments') {
      rewardQuantity = Number(product.rewardQuantity ?? 0);
      await db.update(schema.players).set({ fragments: sql`${schema.players.fragments} + ${rewardQuantity}` }).where(eq(schema.players.id, player.id));
    } else if (product.productType === 'mastery') {
      const biomeId = body.biomeId ?? player.currentBiomeId;
      const targets = await db.select().from(schema.masteryTargets).where(and(eq(schema.masteryTargets.biomeId, biomeId), eq(schema.masteryTargets.rarity, String(product.rarity ?? 'common')))).orderBy(asc(schema.masteryTargets.levelIndex));
      const progressRows = await db.select().from(schema.playerMasteryProgress).where(eq(schema.playerMasteryProgress.playerId, player.id));
      const progressMap = new Map(progressRows.map((row) => [row.targetId, row]));
      const target = targets.find((item) => (progressMap.get(item.id)?.completedLevel ?? 0) < item.maxLevel);
      if (!target) throw new AppError('MASTERY_COMPLETE', '该地图此稀有度专精已经全部完成。');
      const current = progressMap.get(target.id);
      const gain = Number(product.progressQuantity ?? 0);
      const newContributed = Number(current?.contributedQuantity ?? 0) + gain;
      const completedLevel = Math.min(target.maxLevel, Math.floor(newContributed / Number(target.requiredQuantity)));
      await db.insert(schema.playerMasteryProgress).values({ playerId: player.id, targetId: target.id, completedLevel, contributedQuantity: newContributed })
        .onConflictDoUpdate({ target: [schema.playerMasteryProgress.playerId, schema.playerMasteryProgress.targetId], set: { completedLevel, contributedQuantity: newContributed } });
      masteryResult = { biomeId, rarity: target.rarity, targetId: target.id, progressQuantity: gain, contributedQuantity: newContributed, requiredQuantity: Number(target.requiredQuantity), completedLevel };
    }

    stored.spentPoints += product.price;
    stored.purchased[product.id] = (stored.purchased[product.id] ?? 0) + 1;
    await saveWeeklyShopPurchaseState(player.id, stored);
    const shop = await weeklyShopState(player.id);
    return { shop, pointsSpent: product.price, mastery: masteryResult, rewardQuantity, unlockedAvatarId, unlockedTitleId, balances: { gold: player.gold, relics: player.relics, fragments: player.fragments }, serverTime: new Date().toISOString() };
  });

  app.get('/api/weekly-tournaments/history', async (req, reply) => {
    await requireAuth(req, reply);
    return { items: [], nextCursor: null, serverTime: new Date().toISOString() };
  });

  app.get('/api/guild-tournaments/history', async (req, reply) => {
    await requireAuth(req, reply);
    return { items: [], nextCursor: null, serverTime: new Date().toISOString() };
  });

  app.get('/api/guild-tournaments/trophies', async (req, reply) => {
    await requireAuth(req, reply);
    return { trophies: [], items: [], counts: {}, serverTime: new Date().toISOString() };
  });

  app.post('/api/guild-tournaments/:tournamentId/register', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const membership = (await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id)))[0];
    if (!membership) throw new AppError('NOT_IN_GUILD', '你不在公会中。');
    return { success: true, serverTime: new Date().toISOString() };
  });

  app.get('/api/guild-tournaments/:tournamentId/leaderboard', async (req, reply) => {
    await requireAuth(req, reply);
    return { items: [], nextCursor: null, serverTime: new Date().toISOString() };
  });

  app.get('/api/guild-tournaments/:tournamentId/contributions', async (req, reply) => {
    await requireAuth(req, reply);
    return { items: [], nextCursor: null, serverTime: new Date().toISOString() };
  });

  app.get('/api/events/arcane-sacrifice/current-leaderboard', async (req, reply) => {
    await requireAuth(req, reply);
    return { items: [], nextCursor: null, serverTime: new Date().toISOString() };
  });

  app.get('/api/events/arcane-sacrifice/rewards/:rewardId/participants', async (req, reply) => {
    await requireAuth(req, reply);
    return { items: [], nextCursor: null, serverTime: new Date().toISOString() };
  });

  // ============ EVENTS: ARCANE SACRIFICE ============
  app.get('/api/events/arcane-sacrifice', async (req, reply) => {
    const player = await requireAuth(req, reply);
    return buildSacrificeOverview(player.id);
  });

  app.post('/api/events/arcane-sacrifice/contributions', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({
      resourceType: z.enum(['fish', 'gold', 'relic']),
      amount: z.number().int().min(1).optional(),
      quantity: z.number().int().min(1).optional(),
      fishRarity: z.string().optional(),
      rarity: z.string().optional(),
    }).parse(req.body as any);
    const inputQuantity = body.quantity ?? body.amount ?? 1;
    const fishRarity = body.rarity ?? body.fishRarity ?? 'common';

    const today = chinaDate();
    const round = (await db.select().from(schema.arcaneSacrificeRounds).where(and(
      eq(schema.arcaneSacrificeRounds.dayDate, today), eq(schema.arcaneSacrificeRounds.status, 'open'),
    )).orderBy(asc(schema.arcaneSacrificeRounds.roundNumber)).limit(1))[0];
    if (!round) throw new AppError('ROUND_CLOSED', '当前没有可贡献的轮次。');
    if (round.resourceType !== body.resourceType) throw new AppError('WRONG_RESOURCE', `本轮需要献祭 ${round.resourceType}。`);

    let contributionValue = inputQuantity;
    let goldCost = 0;
    if (body.resourceType === 'fish') {
      const rarity = fishRarity;
      const fishDefs = await db.select().from(schema.fish).where(eq(schema.fish.rarity, rarity));
      if (!fishDefs.length) throw new AppError('FISH_NOT_FOUND', '鱼种不存在。');
      const inv = await db.select().from(schema.playerInventoryFish).where(eq(schema.playerInventoryFish.playerId, player.id));
      const totalFish = inv.filter((i) => fishDefs.some((f) => f.id === i.fishId)).reduce((s, i) => s + i.quantity, 0);
      if (totalFish < inputQuantity) throw new AppError('INSUFFICIENT_FISH', '鱼获数量不足。');
      const points = { common: 1, uncommon: 3, fine: 5, rare: 15, epic: 30 }[rarity] ?? 1;
      contributionValue = inputQuantity * points;
      // consume fish from inventory (any of this rarity)
      let toConsume = inputQuantity;
      for (const i of inv) {
        if (toConsume <= 0) break;
        if (!fishDefs.some((f) => f.id === i.fishId)) continue;
        const take = Math.min(toConsume, i.quantity);
        await db.update(schema.playerInventoryFish).set({ quantity: i.quantity - take })
          .where(and(eq(schema.playerInventoryFish.playerId, player.id), eq(schema.playerInventoryFish.fishId, i.fishId)));
        toConsume -= take;
      }
    } else if (body.resourceType === 'gold') {
      if (player.gold < inputQuantity) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
      goldCost = inputQuantity;
    } else {
      if (player.relics < inputQuantity) throw new AppError('INSUFFICIENT_RELICS', '遗物不足。');
    }

    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({
        gold: body.resourceType === 'gold' ? sql`${schema.players.gold} - ${goldCost}` : schema.players.gold,
        relics: body.resourceType === 'relic' ? sql`${schema.players.relics} - ${inputQuantity}` : schema.players.relics,
      }).where(eq(schema.players.id, player.id));
      await tx.insert(schema.arcaneSacrificeContributions).values({
        roundId: round.id, playerId: player.id, resourceType: body.resourceType, amount: contributionValue,
      });
      await tx.update(schema.arcaneSacrificeRounds).set({ progress: sql`${schema.arcaneSacrificeRounds.progress} + ${contributionValue}` }).where(eq(schema.arcaneSacrificeRounds.id, round.id));
    });

    // check round completion
    const updated = (await db.select().from(schema.arcaneSacrificeRounds).where(eq(schema.arcaneSacrificeRounds.id, round.id)))[0];
    if (updated.progress >= updated.target) {
      await db.update(schema.arcaneSacrificeRounds).set({
        status: 'completed', completedAt: new Date(), effectEndsAt: new Date(Date.now() + 4 * 3600 * 1000),
      }).where(eq(schema.arcaneSacrificeRounds.id, round.id));
    }
    const overview = await buildSacrificeOverview(player.id);
    return {
      overview,
      contribution: {
        resourceType: body.resourceType,
        inputQuantity,
        contribution: contributionValue,
        assetBalanceAfter: body.resourceType === 'gold' ? overview.availableAssets.gold : body.resourceType === 'relic' ? overview.availableAssets.relics : ((overview.availableAssets.fish as Record<string, number>)[fishRarity] ?? 0),
      },
      roundCompleted: updated.progress >= updated.target,
      serverTime: new Date().toISOString(),
    };
  });

  app.get('/api/events/arcane-sacrifice/leaderboard', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const q = req.query as any;
    const resourceType = String(q.resourceType ?? 'gold');
    const limit = Math.min(50, Number(q.limit ?? 20));
    const today = chinaDate();
    const round = (await db.select().from(schema.arcaneSacrificeRounds).where(and(
      eq(schema.arcaneSacrificeRounds.dayDate, today), eq(schema.arcaneSacrificeRounds.resourceType, resourceType),
    )).orderBy(asc(schema.arcaneSacrificeRounds.roundNumber)).limit(1))[0];
    if (!round) return { resourceType, items: [], currentPlayer: null, nextCursor: null, serverTime: new Date().toISOString() };
    const contribs = await db.select().from(schema.arcaneSacrificeContributions).where(eq(schema.arcaneSacrificeContributions.roundId, round.id));
    const totals = new Map<string, number>();
    for (const c of contribs) totals.set(c.playerId, (totals.get(c.playerId) ?? 0) + c.amount);
    const players = await db.select().from(schema.players);
    const pMap = new Map(players.map((p) => [p.id, p]));
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    return {
      resourceType,
      items: sorted.slice(0, limit).map(([pid, amount], i) => {
        const p = pMap.get(pid);
        return {
          rank: i + 1,
          contribution: amount,
          reachedContributionAt: null,
          identity: p ? { publicId: p.publicId, nickname: p.nickname, guildTag: null, level: p.level, avatar: { id: 'moonfall-scout', name: '溪谷巡游者', imagePath: '/fish/b_001_common_01.webp', isActive: true }, equippedTitle: null, nameStyle: { mode: 'default' } } : null,
          isCurrentPlayer: pid === player.id,
        };
      }),
      currentPlayer: totals.has(player.id) ? { rank: sorted.findIndex(([pid]) => pid === player.id) + 1, contribution: totals.get(player.id) } : null,
      nextCursor: null,
      serverTime: new Date().toISOString(),
    };
  });

  app.get('/api/events/arcane-sacrifice/rewards', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const limit = Math.min(30, Number((req.query as any).limit ?? 20));
    const rounds = await db.select().from(schema.arcaneSacrificeRounds).where(eq(schema.arcaneSacrificeRounds.status, 'completed')).orderBy(desc(schema.arcaneSacrificeRounds.completedAt)).limit(limit);
    const players = await db.select().from(schema.players);
    const pMap = new Map(players.map((p) => [p.id, p]));
    return {
      items: rounds.map((r) => ({
        id: r.id,
        dayDate: r.dayDate,
        roundNumber: r.roundNumber,
        resourceType: r.resourceType,
        target: r.target,
        participantCount: 0,
        completedAt: r.completedAt?.toISOString() ?? null,
        leader: null,
        randomWinner: null,
      })),
    };
  });

  // ============ GLOBAL NOTIFICATIONS ============
  app.get('/api/fishing/global-notifications/history', async (req, reply) => {
    const limit = Math.min(50, Number((req.query as any).limit ?? 20));
    const rows = await db.select().from(schema.globalNotifications).orderBy(desc(schema.globalNotifications.startsAt)).limit(limit);
    const players = await db.select().from(schema.players);
    const pMap = new Map(players.map((p) => [p.id, p]));
    const fish = await db.select().from(schema.fish);
    const fishMap = new Map(fish.map((f) => [f.id, f]));
    return {
      items: rows.map((n) => {
        const p = pMap.get(n.playerId);
        const f = n.fishId ? fishMap.get(n.fishId) : null;
        return {
          id: n.id, kind: n.kind,
          startsAt: n.startsAt.toISOString(), endsAt: n.endsAt.toISOString(),
          identity: p ? { publicId: p.publicId, nickname: p.nickname, guildTag: null, level: p.level, avatar: { id: 'moonfall-scout', name: '溪谷巡游者', imagePath: '/fish/b_001_common_01.webp', isActive: true }, equippedTitle: null, nameStyle: { mode: 'default' } } : null,
          fish: f ? { id: f.id, name: f.name, biomeId: f.biomeId, rarity: f.rarity } : null,
          quantity: n.quantity,
          caughtAt: n.startsAt.toISOString(),
        };
      }),
      nextCursor: null,
    };
  });

  // ============ SPONSORSHIP ============
  app.get('/api/sponsorship/me', async (req, reply) => {
    const player = await requireAuth(req, reply);
    return { points: 0, totalPoints: 0, serverTime: new Date().toISOString() };
  });

  app.get('/api/sponsorship/credits', async (req, reply) => {
    const limit = Math.min(50, Number((req.query as any).limit ?? 50));
    const rows = await db.select().from(schema.sponsorshipCredits).orderBy(desc(schema.sponsorshipCredits.createdAt)).limit(limit);
    const players = await db.select().from(schema.players);
    const pMap = new Map(players.map((p) => [p.id, p]));
    return {
      items: rows.map((r) => {
        const p = pMap.get(r.playerId);
        return { id: r.id, points: r.points, source: r.source, createdAt: r.createdAt.toISOString(), player: p ? { publicId: p.publicId, nickname: p.nickname, level: p.level } : null };
      }),
      nextCursor: null,
    };
  });

  app.get('/api/sponsorship/cdks/redeem-batch', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const codes = z.array(z.string().trim().min(1).max(32)).max(20).parse((req.body as any)?.codes ?? []);
    const results = [];
    for (const code of codes) {
      const cdk = (await db.select().from(schema.cdkCodes).where(eq(schema.cdkCodes.code, code)))[0];
      if (!cdk) { results.push({ code, success: false, message: '兑换码无效。' }); continue; }
      if (cdk.redemptions >= cdk.maxRedemptions) { results.push({ code, success: false, message: '兑换码已用完。' }); continue; }
      const already = await db.select().from(schema.cdkRedemptions).where(and(eq(schema.cdkRedemptions.code, code), eq(schema.cdkRedemptions.playerId, player.id)));
      if (already.length) { results.push({ code, success: false, message: '已兑换过该礼包码。' }); continue; }
      await db.transaction(async (tx) => {
        await tx.update(schema.cdkCodes).set({ redemptions: cdk.redemptions + 1 }).where(eq(schema.cdkCodes.code, code));
        await tx.insert(schema.cdkRedemptions).values({ code, playerId: player.id });
        const payload = cdk.payload as any;
        if (payload.gold) await tx.update(schema.players).set({ gold: sql`${schema.players.gold} + ${payload.gold}` }).where(eq(schema.players.id, player.id));
        if (payload.relics) await tx.update(schema.players).set({ relics: sql`${schema.players.relics} + ${payload.relics}` }).where(eq(schema.players.id, player.id));
        if (payload.fragments) await tx.update(schema.players).set({ fragments: sql`${schema.players.fragments} + ${payload.fragments}` }).where(eq(schema.players.id, player.id));
        if (payload.chestId) {
          await tx.insert(schema.playerChests).values({ playerId: player.id, chestId: payload.chestId, quantity: payload.quantity ?? 1 })
            .onConflictDoUpdate({ target: [schema.playerChests.playerId, schema.playerChests.chestId], set: { quantity: sql`${schema.playerChests.quantity} + ${payload.quantity ?? 1}` } });
        }
      });
      results.push({ code, success: true, message: '兑换成功。' });
    }
    return { results };
  });

  app.get('/api/fishing/custom-statistics/history', async (req, reply) => {
    return { items: [] };
  });
}

function groupForLevel(level: number): string {
  if (level < 50) return 'rookie';
  if (level < 500) return 'wave';
  return 'tide';
}

async function tournamentPublic(t: typeof schema.tournaments.$inferSelect, myRegs: any[], biomeMap: Map<string, any>, fishMap: Map<string, any>, eligible = true) {
  const targets = (t.targets as Array<{ fishId: string; rarity: string; pointsPerFish: number }>) ?? [];
  const regCount = await db.select({ count: sql<number>`count(*)::int` }).from(schema.tournamentRegistrations).where(eq(schema.tournamentRegistrations.tournamentId, t.id));
  const myReg = myRegs.find((r) => r.tournamentId === t.id);
  return {
    id: t.id,
    type: t.type,
    sequence: t.sequence,
    status: t.status,
    biomeId: t.biomeId,
    biomeName: biomeMap.get(t.biomeId)?.name ?? '',
    startAt: t.startAt.toISOString(),
    endAt: t.endAt.toISOString(),
    registeredCount: Number(regCount[0]?.count ?? 0),
    myGroupId: myReg?.groupId ?? null,
    defaultGroupId: 'rookie',
    registered: !!myReg,
    entryStatus: myReg ? 'registered' : 'not_registered',
    canRegister: t.status === 'scheduled' && eligible && !myReg,
    groups: [{
      id: 'rookie', name: '新星组', biomeId: t.biomeId,
      targets: targets.map((tg) => ({
        score: 0,
        fishId: tg.fishId,
        rarity: tg.rarity,
        pointsPerFish: tg.pointsPerFish,
        caughtQuantity: 0,
        name: fishMap.get(tg.fishId)?.name ?? '',
      })),
    }],
  };
}

async function buildSacrificeOverview(playerId: string) {
  const today = chinaDate();
  const [rounds, contributions, inv, playerRow, trophies] = await Promise.all([
    db.select().from(schema.arcaneSacrificeRounds).where(eq(schema.arcaneSacrificeRounds.dayDate, today)).orderBy(asc(schema.arcaneSacrificeRounds.roundNumber)),
    db.select().from(schema.arcaneSacrificeContributions).where(eq(schema.arcaneSacrificeContributions.playerId, playerId)),
    db.select().from(schema.playerInventoryFish).where(eq(schema.playerInventoryFish.playerId, playerId)),
    db.select().from(schema.players).where(eq(schema.players.id, playerId)),
    db.select().from(schema.playerTrophies).where(eq(schema.playerTrophies.playerId, playerId)),
  ]);
  const trophyCounts = { arcane_chaser: 0, arcane_chased: 0 };
  for (const t of trophies) if (t.trophyId in trophyCounts) trophyCounts[t.trophyId as keyof typeof trophyCounts] += 1;

  const completed = rounds.filter((r) => r.status === 'completed');
  const current = rounds.find((r) => r.status === 'open') ?? null;
  const nextTypes = ['fish', 'gold', 'relic'];
  const resourceType = current?.resourceType ?? null;
  const surge = completed[completed.length - 1];

  const fish = await db.select().from(schema.fish);
  const fishMap = new Map(fish.map((f) => [f.id, f]));
  const fishAssets: Record<string, number> = {};
  for (const i of inv) {
    const def = fishMap.get(i.fishId);
    if (def && ['common', 'uncommon', 'fine', 'rare', 'epic'].includes(def.rarity)) {
      fishAssets[def.rarity] = (fishAssets[def.rarity] ?? 0) + i.quantity;
    }
  }

  const displayRounds = rounds.length > 0 ? rounds : [1, 2].map((roundNumber) => ({
    id: `virtual_${today}_${roundNumber}`,
    dayDate: today,
    roundNumber,
    status: 'scheduled',
    cycleOrdinal: 0,
    resourceType: roundNumber === 1 ? 'fish' : 'gold',
    target: roundNumber === 1 ? 4862900 : 3000000,
    progress: 0,
    opensAt: new Date(Date.now() + (roundNumber - 1) * 4 * 3600000),
    completedAt: null,
    rewardSettlesAt: null,
    settledAt: null,
    effectEndsAt: null,
  }));

  const playerContrib = contributions.filter((c) => c.roundId === current?.id);
  const todayContrib = { fish: 0, gold: 0, relic: 0 };
  for (const c of contributions) {
    if (c.resourceType === 'fish') todayContrib.fish += c.amount;
    if (c.resourceType === 'gold') todayContrib.gold += c.amount;
    if (c.resourceType === 'relic') todayContrib.relic += c.amount;
  }

  return {
    status: completed.length >= 2 && !current ? 'completed' : current ? 'open' : 'ready',
    serverTime: new Date().toISOString(),
    day: { date: today, startsAt: dayStart().toISOString(), endsAt: nextChinaMidnight().toISOString(), completedRounds: completed.length, isCarriedOver: false },
    rounds: displayRounds.map((r) => ({
      roundNumber: r.roundNumber,
      status: r.status,
      cycleOrdinal: r.cycleOrdinal,
      resourceType: r.resourceType,
      target: r.target,
      progress: r.progress,
      remaining: Math.max(0, r.target - r.progress),
      opensAt: r.opensAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      rewardSettlesAt: (r as any).rewardSettlesAt?.toISOString?.() ?? null,
      settledAt: (r as any).settledAt?.toISOString?.() ?? null,
      effectEndsAt: r.effectEndsAt?.toISOString() ?? null,
    })),
    currentRound: current ? {
      roundNumber: current.roundNumber, resourceType: current.resourceType, target: current.target, progress: current.progress, opensAt: current.opensAt.toISOString(),
    } : null,
    nextResourceType: current ? null : nextTypes[completed.length % 3],
    surge: surge && surge.effectEndsAt && surge.effectEndsAt > new Date()
      ? { isActive: true, startedAt: surge.completedAt?.toISOString(), endsAt: surge.effectEndsAt.toISOString(), nextBoundaryAt: surge.effectEndsAt.toISOString() }
      : { isActive: false, startedAt: null, endsAt: null, nextBoundaryAt: null },
    todayContributions: todayContrib,
    currentPlayerRoundContribution: current ? {
      contribution: playerContrib.reduce((s, c) => s + c.amount, 0),
      remaining: Math.max(0, current.target - playerContrib.reduce((s, c) => s + c.amount, 0)),
      limitBasisPoints: 10000,
    } : null,
    availableAssets: {
      gold: playerRow[0].gold,
      relics: playerRow[0].relics,
      fish: { common: fishAssets.common ?? 0, uncommon: fishAssets.uncommon ?? 0, fine: fishAssets.fine ?? 0, rare: fishAssets.rare ?? 0, epic: fishAssets.epic ?? 0 },
    },
    rewards: {
      leaderboardTrophy: { type: 'arcane_chaser', name: '奥术追逐者', allStatBonus: 5 },
      randomTrophy: { type: 'arcane_chased', name: '被奥术追逐者', allStatBonus: 5 },
      participationMedal: { type: 'arcane_researcher', name: '奥术研究员', allStatBonus: 2 },
      randomWinnerLimit: 3,
      randomGroupSize: 15,
      minimumRandomWinnerCount: 3,
      randomShareThresholdBasisPoints: 100,
      participationShareThresholdBasisPoints: 50,
      playerTrophies: { counts: { ...trophyCounts, arcane_researcher: 0 }, totalStatBonus: (trophyCounts.arcane_chaser + trophyCounts.arcane_chased) * 5 },
    },
    rotationVersion: 'arcane-sacrifice-rotation-v1',
    targetFormulaVersion: 'arcane-sacrifice-target-v2',
    fishPoints: { common: 1, uncommon: 3, fine: 5, rare: 15, epic: 30 },
    todayLeaderboard: await sacrificeLeaderboard(today, playerId),
    currentPlayerRank: (await sacrificeLeaderboard(today, playerId)).find((e: any) => e.isCurrentPlayer)?.rank ?? null,
  };
}

async function sacrificeLeaderboard(today: string, currentPlayerId: string) {
  const round = (await db.select().from(schema.arcaneSacrificeRounds).where(and(
    eq(schema.arcaneSacrificeRounds.dayDate, today), eq(schema.arcaneSacrificeRounds.status, 'open'),
  )).orderBy(desc(schema.arcaneSacrificeRounds.roundNumber)).limit(1))[0];
  if (!round) return [];
  const contribs = await db.select().from(schema.arcaneSacrificeContributions).where(eq(schema.arcaneSacrificeContributions.roundId, round.id));
  const totals = new Map<string, number>();
  for (const c of contribs) totals.set(c.playerId, (totals.get(c.playerId) ?? 0) + c.amount);
  const players = await db.select().from(schema.players);
  const pMap = new Map(players.map((p) => [p.id, p]));
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  return sorted.map(([pid, amount], i) => {
    const p = pMap.get(pid);
    return {
      rank: i + 1,
      contribution: amount,
      reachedContributionAt: null,
      identity: p ? { publicId: p.publicId, nickname: p.nickname, guildTag: null, level: p.level, avatar: { id: 'moonfall-scout', name: '溪谷巡游者', imagePath: '/fish/b_001_common_01.webp', isActive: true }, equippedTitle: null, nameStyle: { mode: 'default' } } : null,
      isCurrentPlayer: pid === currentPlayerId,
    };
  });
}

function dayStart(): Date {
  const now = new Date();
  const china = new Date(now.getTime() + 8 * 3600 * 1000);
  return new Date(Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate(), 0, 0, 0) - 8 * 3600 * 1000);
}

function nextChinaMidnight(): Date {
  const now = new Date();
  const china = new Date(now.getTime() + 8 * 3600 * 1000);
  return new Date(Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate() + 1, 0, 0, 0) - 8 * 3600 * 1000);
}

const WEEKLY_SHOP_AVATARS = [
  { id: 'weekly_avatar_cloud_tide_courier', name: '云汐旅人', description: '永久解锁的原创头像。', price: 600000, weeklyLimit: 1, avatarId: '14000000-0000-4000-8000-000000000001' },
  { id: 'weekly_avatar_sunlit_reef_herald', name: '晴礁报潮者', description: '永久解锁的原创头像。', price: 600000, weeklyLimit: 1, avatarId: '14000000-0000-4000-8000-000000000004' },
  { id: 'weekly_avatar_reedwind_lantern_artisan', name: '苇风鱼灯师', description: '永久解锁的原创头像。', price: 600000, weeklyLimit: 1, avatarId: '14000000-0000-4000-8000-000000000007' },
  { id: 'weekly_avatar_prism_navigator', name: '棱流领航者', description: '永久解锁的高阶原创头像。', price: 1200000, weeklyLimit: 1, avatarId: '14000000-0000-4000-8000-000000000002' },
  { id: 'weekly_avatar_astral_tide_observer', name: '星汐观测者', description: '永久解锁的高阶原创头像。', price: 1200000, weeklyLimit: 1, avatarId: '14000000-0000-4000-8000-000000000005' },
  { id: 'weekly_avatar_stormtide_ranger', name: '雷潮巡弋者', description: '永久解锁的高阶原创头像。', price: 1200000, weeklyLimit: 1, avatarId: '14000000-0000-4000-8000-000000000008' },
  { id: 'weekly_avatar_celestial_sovereign', name: '星海潮冕', description: '永久解锁的最高阶典藏头像。', price: 2000000, weeklyLimit: 1, avatarId: '14000000-0000-4000-8000-000000000003' },
  { id: 'weekly_avatar_leviathan_oracle', name: '鲲潮神谕', description: '永久解锁的最高阶典藏头像。', price: 2000000, weeklyLimit: 1, avatarId: '14000000-0000-4000-8000-000000000006' },
  { id: 'weekly_avatar_solar_tide_archon', name: '曜潮执政官', description: '永久解锁的最高阶典藏头像。', price: 2000000, weeklyLimit: 1, avatarId: '14000000-0000-4000-8000-000000000009' },
];
const WEEKLY_SHOP_TITLES = [
  { id: 'weekly_title_cloud_tide_roamer', titleId: 'weekly_shop_cloud_tide_roamer', name: '云汐漫游者', description: '愿每一次出发都有潮声相伴。', price: 450000, style: { textColor: '#0B5E68', backgroundColor: '#E1F7F5', borderColor: '#49B4BE', borderEffect: 'tournament-tide' } },
  { id: 'weekly_title_deep_blue_dreamer', titleId: 'weekly_shop_deep_blue_dreamer', name: '深蓝异想家', description: '在无人抵达的水色里继续想象。', price: 900000, style: { textColor: '#DCEEFF', backgroundColor: '#0B2A50', borderColor: '#3D8EDB', borderEffect: 'tournament-abyss' } },
  { id: 'weekly_title_stellar_guide', titleId: 'weekly_shop_stellar_guide', name: '星海引路人', description: '以星光标记远方，以潮汐校准归途。', price: 1400000, style: { textColor: '#F6EEFF', backgroundColor: '#211747', borderColor: '#B48AFF', borderEffect: 'tournament-stellar' } },
  { id: 'weekly_title_all_tides_sovereign', titleId: 'weekly_shop_all_tides_sovereign', name: '万象潮主', description: '万千潮汐在此交汇，唯此名回应星海。', price: 2000000, style: { textColor: '#FFE8A3', backgroundColor: '#2E1D32', borderColor: '#F0BA4D', borderEffect: 'tournament-sovereign' } },
];
const WEEKLY_MASTERY_PRODUCTS = [
  ['common', '普通专精补给', 50000, 5, 1000], ['uncommon', '罕见专精补给', 100000, 3, 600],
  ['fine', '精良专精补给', 120000, 3, 300], ['rare', '稀有专精补给', 150000, 2, 90],
  ['epic', '史诗专精补给', 180000, 2, 24], ['legendary', '传说专精补给', 240000, 2, 8],
  ['mythic', '神话专精补给', 300000, 2, 3], ['exotic', '奇异专精补给', 600000, 2, 1],
  ['arcane', '奥秘专精补给', 1200000, 1, 1],
] as const;
const RARITY_NAMES: Record<string, string> = { common: '普通', uncommon: '罕见', fine: '精良', rare: '稀有', epic: '史诗', legendary: '传说', mythic: '神话', exotic: '奇异', arcane: '奥秘' };

function weeklyShopWindow() {
  const now = new Date();
  const china = new Date(now.getTime() + 8 * 3600_000);
  const day = (china.getUTCDay() + 6) % 7;
  const mondayUtc = Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate() - day) - 8 * 3600_000;
  return { weekStart: chinaDate(new Date(mondayUtc)), resetsAt: new Date(mondayUtc + 7 * 86400_000).toISOString() };
}

function weeklyShopSettingKey(playerId: string) {
  return `weekly-shop:${playerId}:${weeklyShopWindow().weekStart}`;
}

async function loadWeeklyShopPurchaseState(playerId: string) {
  const row = (await db.select().from(schema.globalSettings).where(eq(schema.globalSettings.key, weeklyShopSettingKey(playerId))))[0];
  const value = row?.value as { spentPoints?: number; purchased?: Record<string, number> } | undefined;
  return { spentPoints: Number(value?.spentPoints ?? 0), purchased: value?.purchased ?? {} };
}

async function saveWeeklyShopPurchaseState(playerId: string, value: { spentPoints: number; purchased: Record<string, number> }) {
  const key = weeklyShopSettingKey(playerId);
  await db.insert(schema.globalSettings).values({ key, value }).onConflictDoUpdate({ target: schema.globalSettings.key, set: { value, updatedAt: new Date() } });
}

async function ensureWeeklyAvatars() {
  for (const item of WEEKLY_SHOP_AVATARS) {
    await db.insert(schema.avatars).values({ id: item.avatarId, name: item.name, imagePath: `/api/avatars/${item.avatarId}/image`, source: 'weekly', isActive: true, orderIndex: 100 })
      .onConflictDoNothing();
  }
}

async function ensureWeeklyTitles() {
  for (const item of WEEKLY_SHOP_TITLES) {
    await db.insert(schema.titles).values({ id: item.titleId, name: item.name, description: item.description, imagePath: '', textColor: item.style.textColor, backgroundColor: item.style.backgroundColor, borderColor: item.style.borderColor, borderEffect: null, isInternal: false })
      .onConflictDoNothing();
  }
}

async function weeklyShopState(playerId: string) {
  const player = (await db.select().from(schema.players).where(eq(schema.players.id, playerId)))[0];
  if (!player) throw new AppError('PLAYER_NOT_FOUND', '玩家不存在。', 404);
  await Promise.all([ensureWeeklyAvatars(), ensureWeeklyTitles()]);
  const [events, ownedAvatars, purchaseState, ownedTitles, targets, progressRows, fishRows] = await Promise.all([
    db.select().from(schema.weeklyTournamentCatchEvents).where(eq(schema.weeklyTournamentCatchEvents.playerId, playerId)),
    db.select().from(schema.playerAvatars).where(eq(schema.playerAvatars.playerId, playerId)),
    loadWeeklyShopPurchaseState(playerId),
    db.select().from(schema.globalSettings).where(eq(schema.globalSettings.key, `player-lighthouse-titles:${playerId}`)),
    db.select().from(schema.masteryTargets).orderBy(asc(schema.masteryTargets.biomeId), asc(schema.masteryTargets.levelIndex)),
    db.select().from(schema.playerMasteryProgress).where(eq(schema.playerMasteryProgress.playerId, playerId)),
    db.select().from(schema.fish),
  ]);
  const window = weeklyShopWindow();
  const earnedPoints = events.reduce((sum, event) => sum + Number(event.points), 0);
  const spentPoints = purchaseState.spentPoints;
  const availablePoints = Math.max(0, earnedPoints - spentPoints);
  const ownedAvatarIds = new Set(ownedAvatars.map((row) => row.avatarId));
  const ownedTitleIds = new Set(Array.isArray(ownedTitles[0]?.value) ? ownedTitles[0].value.filter((item): item is string => typeof item === 'string') : []);
  const progressMap = new Map(progressRows.map((row) => [row.targetId, row]));
  const fishMap = new Map(fishRows.map((row) => [row.id, row]));
  const biomeRows = await db.select().from(schema.biomes);
  const biomeMap = new Map(biomeRows.map((row) => [row.id, row]));
  const products: any[] = [];
  for (const item of WEEKLY_SHOP_AVATARS) {
    const isOwned = ownedAvatarIds.has(item.avatarId);
    const purchasedCount = purchaseState.purchased[item.id] ?? 0;
    const remainingLimit = Math.max(0, item.weeklyLimit - purchasedCount);
    products.push({
      id: item.id, name: item.name, description: item.description, price: item.price,
      weeklyLimit: item.weeklyLimit, purchasedCount, remainingLimit,
      availability: isOwned ? 'owned' : remainingLimit <= 0 ? 'sold_out' : availablePoints < item.price ? 'insufficient_points' : 'available',
      productType: 'avatar', avatar: { id: item.avatarId, name: item.name, imagePath: `/api/avatars/${item.avatarId}/image`, isActive: true }, isOwned,
    });
  }
  for (const item of WEEKLY_SHOP_TITLES) {
    const isOwned = ownedTitleIds.has(item.titleId);
    const purchasedCount = purchaseState.purchased[item.id] ?? 0;
    const remainingLimit = Math.max(0, 1 - purchasedCount);
    products.push({
      id: item.id, name: item.name, description: item.description, price: item.price,
      weeklyLimit: 1, purchasedCount, remainingLimit,
      availability: isOwned ? 'owned' : remainingLimit <= 0 ? 'sold_out' : availablePoints < item.price ? 'insufficient_points' : 'available',
      productType: 'title', title: { id: item.titleId, name: item.name, description: item.description, style: item.style }, isOwned,
    });
  }
  products.push({ id: 'weekly_relic_bundle', name: '遗物补给匣', description: '立即获得 300 遗物。', price: 100000, weeklyLimit: 3, purchasedCount: purchaseState.purchased.weekly_relic_bundle ?? 0, remainingLimit: Math.max(0, 3 - (purchaseState.purchased.weekly_relic_bundle ?? 0)), availability: availablePoints >= 100000 ? 'available' : 'insufficient_points', productType: 'relics', rewardQuantity: 300 });
  products.push({ id: 'weekly_fragment_bundle', name: '奥秘碎片匣', description: '立即获得 100 奥秘碎片。', price: 150000, weeklyLimit: 2, purchasedCount: purchaseState.purchased.weekly_fragment_bundle ?? 0, remainingLimit: Math.max(0, 2 - (purchaseState.purchased.weekly_fragment_bundle ?? 0)), availability: availablePoints >= 150000 ? 'available' : 'insufficient_points', productType: 'fragments', rewardQuantity: 100 });
  for (const [rarity, name, price, limit, progressQuantity] of WEEKLY_MASTERY_PRODUCTS) {
    const id = `weekly_mastery_${rarity}`;
    const purchasedCount = purchaseState.purchased[id] ?? 0;
    products.push({
      id, name, description: `为所选地图的当前${RARITY_NAMES[rarity]}专精目标增加进度。`, price,
      weeklyLimit: limit, purchasedCount, remainingLimit: Math.max(0, limit - purchasedCount),
      availability: availablePoints < price ? 'insufficient_points' : 'available', productType: 'mastery',
      rarity, rarityName: RARITY_NAMES[rarity], progressQuantity,
    });
  }
  const seen = new Set<string>();
  const masteryTargets: any[] = [];
  for (const target of targets) {
    const key = `${target.biomeId}:${target.rarity}`;
    if (seen.has(key)) continue;
    const progress = progressMap.get(target.id);
    if ((progress?.completedLevel ?? 0) >= target.maxLevel) continue;
    seen.add(key);
    const fish = fishMap.get(target.fishId);
    if (!fish) continue;
    const contributedQuantity = Number(progress?.contributedQuantity ?? 0);
    masteryTargets.push({
      biomeId: target.biomeId, biomeName: biomeMap.get(target.biomeId)?.name ?? target.biomeId,
      rarity: target.rarity, rarityName: RARITY_NAMES[target.rarity] ?? target.rarity,
      targetLevel: (progress?.completedLevel ?? 0) + 1,
      fish: { id: fish.id, name: fish.name, imagePath: fish.imagePath },
      requiredQuantity: Number(target.requiredQuantity), contributedQuantity, remainingQuantity: Math.max(0, Number(target.requiredQuantity) - contributedQuantity),
    });
  }
  const previousEnd = new Date(Date.parse(window.resetsAt) - 7 * 86400_000).toISOString();
  const previousStart = new Date(Date.parse(previousEnd) - 7 * 86400_000).toISOString();
  return {
    state: 'open',
    source: { tournamentId: `weekly-shop-${window.weekStart}`, sequence: 0, startAt: previousStart, endAt: previousEnd, purchaseEndsAt: window.resetsAt, weeklyLimitResetsAt: window.resetsAt, earnedPoints, spentPoints, availablePoints },
    products,
    masteryTargets,
    hasPendingPoints: false,
    serverTime: new Date().toISOString(),
  };
}
