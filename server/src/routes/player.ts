import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { eq, and, sql, asc } from 'drizzle-orm';
import { requireAuth, requireAuthOrNull } from '../services/auth.js';
import { AppError } from '../util/errors.js';
import { loadPlayerContext } from '../services/playerState.js';
import { buildSession } from './auth.js';

export async function registerPlayerRoutes(app: FastifyInstance) {
  app.get('/api/players/:publicId', async (req, reply) => {
    const authPlayer = await requireAuthOrNull(req, reply);
    const publicId = Number((req.params as any).publicId);
    const player = (await db.select().from(schema.players).where(eq(schema.players.publicId, publicId)))[0];
    if (!player) throw new AppError('PLAYER_NOT_FOUND', '玩家不存在。', 404);

    const [avatar, title, guildMember, showcaseFish, showcaseAch, inventory] = await Promise.all([
      db.select().from(schema.avatars).where(eq(schema.avatars.id, player.avatarId)),
      player.equippedTitleId ? db.select().from(schema.titles).where(eq(schema.titles.id, player.equippedTitleId)) : Promise.resolve([]),
      db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id)),
      db.select().from(schema.playerInventoryFish).where(eq(schema.playerInventoryFish.playerId, player.id)),
      db.select().from(schema.playerAchievements).where(eq(schema.playerAchievements.playerId, player.id)),
      db.select().from(schema.fish),
    ]);

    let guildTag: string | null = null;
    let guildName: string | null = null;
    if (guildMember[0]) {
      const g = (await db.select().from(schema.guilds).where(eq(schema.guilds.id, guildMember[0].guildId)))[0];
      guildTag = g?.tag ?? null;
      guildName = g?.name ?? null;
    }

    const fishDefMap = new Map(inventory.map((f) => [f.id, f]));
    const fishShowcase = (player.showcaseFishIds ?? []).map((id) => {
      const def = fishDefMap.get(id);
      const inv = showcaseFish.find((x) => x.fishId === id);
      return def ? { fishId: id, name: def.name, rarity: def.rarity, imagePath: def.imagePath, quantity: inv?.quantity ?? 0 } : null;
    }).filter(Boolean);

    const achShowcase = (player.achievementShowcaseIds ?? []).map((id) => {
      const rec = showcaseAch.find((a) => a.achievementId === id);
      const def = (rec?.status ?? '') === '' ? null : null;
      void def;
      return rec && rec.status === 'claimed' ? { achievementId: id } : null;
    }).filter(Boolean);

    const ctx = await loadPlayerContext(player.id);
    const currentBiome = (await db.select().from(schema.biomes).where(eq(schema.biomes.id, player.currentBiomeId)))[0];

    return {
      identity: {
        publicId: player.publicId,
        nickname: player.nickname,
        guildTag,
        guildName,
        level: player.level,
        reincarnationRound: ctx.reincarnation?.round ?? 0,
        avatar: avatar[0] ? { id: avatar[0].id, name: avatar[0].name, imagePath: avatar[0].imagePath, isActive: true } : { id: 'moonfall-scout', name: '溪谷巡游者', imagePath: '/fish/b_001_common_01.webp', isActive: true },
        equippedTitle: title[0] ? { id: title[0].id, name: title[0].name, imagePath: title[0].imagePath, description: title[0].description } : null,
        nameStyle: { mode: player.nameStyleMode, colors: player.nameStyleColors ?? [], angle: player.nameStyleAngle ?? undefined },
        equippedFishShowcaseId: player.equippedFishShowcaseId,
        fishShowcase,
        achievementShowcase: achShowcase,
      },
      isSelf: authPlayer?.id === player.id,
      registeredAt: player.createdAt.toISOString(),
      currentBiome: currentBiome ? { id: currentBiome.id, name: currentBiome.name } : null,
      guild: guildTag ? { publicId: 0, name: guildName, tag: guildTag, nameStyle: { mode: 'default', colors: [] } } : null,
      medals: {
        personalTournament: { medals: [
          { type: 'diamond', count: 0, bonusPerMedal: 5 }, { type: 'platinum', count: 0, bonusPerMedal: 4 },
          { type: 'gold', count: 0, bonusPerMedal: 3 }, { type: 'silver', count: 0, bonusPerMedal: 2 },
          { type: 'bronze', count: 0, bonusPerMedal: 2 }, { type: 'participation', count: 0, bonusPerMedal: 2 },
        ], totalStatBonus: 0 },
        weeklyTournament: { medals: [
          { type: 'champion', count: 0, bonusPerMedal: 20 }, { type: 'runner_up', count: 0, bonusPerMedal: 18 },
          { type: 'third', count: 0, bonusPerMedal: 16 }, { type: 'fourth', count: 0, bonusPerMedal: 14 },
          { type: 'fifth', count: 0, bonusPerMedal: 12 }, { type: 'participation', count: 0, bonusPerMedal: 10 },
        ], rawStatBonus: 0, effectiveStatBonus: 0, statBonusCap: 1000 },
        arcaneSacrifice: { trophies: [
          { type: 'arcane_chaser', name: '奥术追逐者', count: 0, bonusPerTrophy: 5 },
          { type: 'arcane_chased', name: '被奥术追逐者', count: 0, bonusPerTrophy: 5 },
          { type: 'arcane_researcher', name: '奥术研究员', count: 0, bonusPerTrophy: 2 },
        ], totalStatBonus: 0 },
      },
      achievements: [],
      fish: fishShowcase.map((item: any) => { const def = inventory.find((f) => f.id === item.fishId); return { id: item.fishId, name: item.name, rarity: item.rarity, rarityName: item.rarity, imagePath: item.imagePath, biomeId: def?.biomeId ?? player.currentBiomeId, biomeName: currentBiome?.name ?? '', totalCaught: item.quantity }; }),
      worldBossCollections: { registeredCount: 0, sets: [] },
      stats: ctx.stats,
      catches: {
        total: player.totalCasts,
        fish: player.totalFishCaught,
        discovered: showcaseFish.filter((f) => f.totalCaught > 0).length,
      },
      trophies: ctx.trophyIds,
      weeklyMedals: ctx.weeklyMedalIds,
      serverTime: new Date().toISOString(),
    };
  });

  app.get('/api/players/:publicId/statistics', async (req, reply) => {
    const publicId = Number((req.params as any).publicId);
    const player = (await db.select().from(schema.players).where(eq(schema.players.publicId, publicId)))[0];
    if (!player) throw new AppError('PLAYER_NOT_FOUND', '玩家不存在。', 404);
    const [stats, weatherCasts, baitCasts, biomeCasts, inv, fishRows] = await Promise.all([
      db.select().from(schema.playerStats).where(eq(schema.playerStats.playerId, player.id)),
      db.select().from(schema.playerWeatherCasts).where(eq(schema.playerWeatherCasts.playerId, player.id)),
      db.select().from(schema.playerBaitCasts).where(eq(schema.playerBaitCasts.playerId, player.id)),
      db.select().from(schema.playerBiomeCasts).where(eq(schema.playerBiomeCasts.playerId, player.id)),
      db.select().from(schema.playerInventoryFish).where(eq(schema.playerInventoryFish.playerId, player.id)),
      db.select().from(schema.fish),
    ]);
    const st = stats[0];
    const discovered = inv.filter((x) => x.totalCaught > 0).length;
    const runs = await db.select().from(schema.fishingRuns).where(eq(schema.fishingRuns.playerId, player.id));
    const fishingGold = runs.reduce((sum, r) => sum + r.batchGold, 0);
    const fishingExperience = runs.reduce((sum, r) => sum + r.batchExperience, 0);
    const wMap = new Map(weatherCasts.map((x) => [x.weatherId, x.casts]));
    const bMap = new Map(baitCasts.map((x) => [x.baitId, x.casts]));
    const bcMap = new Map(biomeCasts.map((x) => [x.biomeId, x.casts]));
    const weatherDefs = await db.select().from(schema.weather).orderBy(schema.weather.orderIndex);
    return {
      totals: {
        totalCasts: player.totalCasts,
        onlineCasts: st?.onlineCasts ?? 0,
        offlineCasts: st?.offlineCasts ?? 0,
        totalFishCaught: player.totalFishCaught,
        discoveredFish: discovered,
        totalFishDefinitions: fishRows.length,
        fishpediaPercentage: Math.round((discovered / Math.max(1, fishRows.length)) * 10000) / 100,
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
      weather: weatherDefs.map((w) => ({ weatherId: w.id, name: w.name, casts: wMap.get(w.id) ?? 0 })),
      rarities: ['common', 'uncommon', 'fine', 'rare', 'epic', 'legendary', 'mythic', 'exotic', 'arcane'].map((r) => ({
        rarity: r,
        name: ({ common: '普通', uncommon: '罕见', fine: '精良', rare: '稀有', epic: '史诗', legendary: '传说', mythic: '神话', exotic: '奇异', arcane: '奥秘' } as Record<string, string>)[r],
        fishCaught: inv.filter((x) => x.totalCaught > 0 && fishRows.find((f) => f.id === x.fishId)?.rarity === r).reduce((sum, x) => sum + x.totalCaught, 0),
      })),
      serverTime: new Date().toISOString(),
    };
  });

  app.put('/api/player-profile/nickname', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const nickname = z.string().trim().min(2).max(24).parse((req.body as any)?.nickname);
    const taken = await db.select().from(schema.players).where(eq(schema.players.nickname, nickname));
    if (taken.length && taken[0].id !== player.id) throw new AppError('NICKNAME_TAKEN', '该角色名已被使用。');
    await db.update(schema.players).set({ nickname }).where(eq(schema.players.id, player.id));
    return { publicIdentity: await publicIdentity(player.id), serverTime: new Date().toISOString() };
  });

  app.put('/api/player-profile/avatar', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const avatarId = String((req.body as any)?.avatarId ?? '');
    const owned = await db.select().from(schema.playerAvatars).where(and(eq(schema.playerAvatars.playerId, player.id), eq(schema.playerAvatars.avatarId, avatarId)));
    if (!owned.length) throw new AppError('AVATAR_NOT_OWNED', '尚未解锁该头像。');
    await db.update(schema.players).set({ avatarId }).where(eq(schema.players.id, player.id));
    return { publicIdentity: await publicIdentity(player.id), serverTime: new Date().toISOString() };
  });

  app.put('/api/player/equipped-title', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const titleId = (req.body as any)?.titleId ?? null;
    if (titleId) {
      const titlesState = await playerTitles(player.id);
      const title = titlesState.titles.find((item: any) => item.id === titleId);
      if (!title) throw new AppError('TITLE_NOT_FOUND', '称号不存在。');
      if (!title.isUnlocked) throw new AppError('TITLE_LOCKED', '尚未解锁该称号。');
    }
    await db.update(schema.players).set({ equippedTitleId: titleId ?? null }).where(eq(schema.players.id, player.id));
    return { ...await playerTitles(player.id), publicIdentity: await publicIdentity(player.id), serverTime: new Date().toISOString() };
  });

  app.put('/api/player-profile/name-style', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({
      mode: z.enum(['default', 'solid', 'gradient']),
      color: z.string().optional(),
      colors: z.array(z.string()).max(2).optional(),
      angle: z.number().optional(),
    }).parse(req.body as any);
    const cost = body.mode === 'gradient' ? 10000000 + (body.colors?.length === 2 ? 3000000 : 0) : body.mode === 'solid' ? 5000000 : 0;
    const p = (await db.select().from(schema.players).where(eq(schema.players.id, player.id)))[0];
    if (p.gold < cost) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({
        gold: sql`${schema.players.gold} - ${cost}`,
        nameStyleMode: body.mode,
        nameStyleColors: body.mode === 'default' ? [] : body.mode === 'gradient' ? (body.colors ?? []) : body.color ? [body.color] : [],
        nameStyleAngle: body.mode === 'gradient' ? (body.angle ?? 180) : null,
      }).where(eq(schema.players.id, player.id));
    });
    return { publicIdentity: await publicIdentity(player.id), player: await publicPlayerShort(player.id), serverTime: new Date().toISOString() };
  });

  app.put('/api/player-profile/fish-showcase', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const fishId = (req.body as any)?.fishId ?? null;
    await db.update(schema.players).set({ equippedFishShowcaseId: fishId ?? null }).where(eq(schema.players.id, player.id));
    return { success: true };
  });

  app.put('/api/player-profile/achievement-showcase', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const achievementIds = z.array(z.string()).max(5).parse((req.body as any)?.achievementIds ?? []);
    await db.update(schema.players).set({ achievementShowcaseIds: achievementIds }).where(eq(schema.players.id, player.id));
    return { success: true };
  });

  app.put('/api/player-profile/settings', async (req, reply) => {
    const player = await requireAuth(req, reply);
    void player;
    return { success: true };
  });

  app.post('/api/player/stats/allocate', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const allocationSchema = z.object({
      strength: z.number().int().min(0).max(1_000_000),
      intelligence: z.number().int().min(0).max(1_000_000),
      luck: z.number().int().min(0).max(1_000_000),
      endurance: z.number().int().min(0).max(1_000_000),
    });
    const allocation = allocationSchema.parse(req.body as any);
    const total = allocation.strength + allocation.intelligence + allocation.luck + allocation.endurance;
    if (total > player.unspentStatPoints) throw new AppError('INSUFFICIENT_STAT_POINTS', '属性点不足。');
    if (total === 0) {
      const session = await buildSession(player);
      return { player: session.player, serverTime: session.serverTime };
    }

    const updated = (await db.update(schema.players).set({
      baseStrength: sql`${schema.players.baseStrength} + ${allocation.strength}`,
      baseIntelligence: sql`${schema.players.baseIntelligence} + ${allocation.intelligence}`,
      baseLuck: sql`${schema.players.baseLuck} + ${allocation.luck}`,
      baseEndurance: sql`${schema.players.baseEndurance} + ${allocation.endurance}`,
      unspentStatPoints: sql`${schema.players.unspentStatPoints} - ${total}`,
    }).where(and(eq(schema.players.id, player.id), sql`${schema.players.unspentStatPoints} >= ${total}`)).returning())[0];
    if (!updated) throw new AppError('INSUFFICIENT_STAT_POINTS', '属性点不足。');
    const session = await buildSession(updated);
    return { player: session.player, serverTime: session.serverTime };
  });

  app.post('/api/player/stats/reset', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const meta = (await db.select().from(schema.contentMeta))[0];
    const cost = meta?.statResetCostGold ?? 10000;
    if (player.gold < cost) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    const allocated = (player.baseStrength + player.baseIntelligence + player.baseLuck + player.baseEndurance) - 100;
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({
        gold: sql`${schema.players.gold} - ${cost}`,
        baseStrength: 0, baseIntelligence: 0, baseLuck: 0, baseEndurance: 100,
        unspentStatPoints: sql`${schema.players.unspentStatPoints} + ${Math.max(0, allocated)}`,
      }).where(eq(schema.players.id, player.id));
    });
    const updated = (await db.select().from(schema.players).where(eq(schema.players.id, player.id)))[0];
    const session = await buildSession(updated);
    return { player: session.player, serverTime: session.serverTime };
  });

  app.post('/api/player/gold-penalty/acknowledge', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const total = Number((req.body as any)?.total ?? 0);
    await db.update(schema.players).set({ acknowledgedGoldPenaltyTotal: total }).where(eq(schema.players.id, player.id));
    return { goldPenaltyTotal: total, acknowledgedGoldPenaltyTotal: total, serverTime: new Date().toISOString() };
  });

  app.get('/api/player/titles', async (req, reply) => {
    const player = await requireAuth(req, reply);
    return playerTitles(player.id);
  });

  app.get('/api/account', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const account = (await db.select().from(schema.accounts).where(eq(schema.accounts.id, player.accountId)))[0];
    return { email: account.email, serverTime: new Date().toISOString() };
  });
}

async function playerTitles(playerId: string) {
  const [achievements, titles, playerAch, player, lighthouseSetting] = await Promise.all([
    db.select().from(schema.achievementDefinitions),
    db.select().from(schema.titles).orderBy(asc(schema.titles.orderIndex)),
    db.select().from(schema.playerAchievements).where(eq(schema.playerAchievements.playerId, playerId)),
    db.select().from(schema.players).where(eq(schema.players.id, playerId)),
    db.select().from(schema.globalSettings).where(eq(schema.globalSettings.key, `player-lighthouse-titles:${playerId}`)),
  ]);
  const achMap = new Map(playerAch.map((a) => [a.achievementId, a]));
  const unlocked = new Set<string>();
  for (const achievement of achievements) {
    if (achievement.titleId && achMap.get(achievement.id)?.status === 'claimed') unlocked.add(achievement.titleId);
  }
  if (Array.isArray(lighthouseSetting[0]?.value)) {
    for (const id of lighthouseSetting[0].value) if (typeof id === 'string') unlocked.add(id);
  }
  return {
    titles: titles.map((title) => ({
      id: title.id,
      name: title.name,
      description: title.description,
      imagePath: title.imagePath,
      textColor: title.textColor,
      backgroundColor: title.backgroundColor,
      borderColor: title.borderColor,
      borderEffect: title.borderEffect,
      isUnlocked: unlocked.has(title.id) || title.isInternal,
      isEquipped: player[0]?.equippedTitleId === title.id,
    })),
    equippedTitle: player[0]?.equippedTitleId ? titles.find((t) => t.id === player[0].equippedTitleId) ?? null : null,
    serverTime: new Date().toISOString(),
  };
}

async function publicIdentity(playerId: string) {
  const player = (await db.select().from(schema.players).where(eq(schema.players.id, playerId)))[0];
  const [avatar, title] = await Promise.all([
    db.select().from(schema.avatars).where(eq(schema.avatars.id, player.avatarId)),
    player.equippedTitleId ? db.select().from(schema.titles).where(eq(schema.titles.id, player.equippedTitleId)) : Promise.resolve([]),
  ]);
  return {
    publicId: player.publicId,
    nickname: player.nickname,
    guildTag: null,
    level: player.level,
    avatar: avatar[0] ? { id: avatar[0].id, name: avatar[0].name, imagePath: avatar[0].imagePath, isActive: true } : { id: 'moonfall-scout', name: '溪谷巡游者', imagePath: '/fish/b_001_common_01.webp', isActive: true },
    equippedTitle: title[0] ? { id: title[0].id, name: title[0].name, imagePath: title[0].imagePath, description: title[0].description } : null,
    nameStyle: { mode: player.nameStyleMode, colors: player.nameStyleColors ?? [], angle: player.nameStyleAngle ?? undefined },
  };
}

async function publicPlayerShort(playerId: string) {
  const p = (await db.select().from(schema.players).where(eq(schema.players.id, playerId)))[0];
  return {
    id: p.id, nickname: p.nickname, level: p.level, experience: p.experience,
    gold: p.gold, relics: p.relics, fragments: p.fragments, unspentStatPoints: p.unspentStatPoints,
    baseStrength: p.baseStrength, baseIntelligence: p.baseIntelligence, baseLuck: p.baseLuck, baseEndurance: p.baseEndurance,
    currentBiomeId: p.currentBiomeId, equippedRodId: p.equippedRodId, selectedBaitId: p.selectedBaitId,
  };
}
