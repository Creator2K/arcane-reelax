import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { eq, and, sql, desc, asc } from 'drizzle-orm';
import { requireAuth } from '../services/auth.js';
import { buildSession } from './auth.js';
import { AppError } from '../util/errors.js';
import { QUEST_REROLL_COST } from '../constants.js';

export async function registerProgressionRoutes(app: FastifyInstance) {
  app.get('/api/quests', async (req, reply) => {
    const player = await requireAuth(req, reply);
    await ensureQuests(player.id);
    const rows = await db.select().from(schema.playerQuests).where(eq(schema.playerQuests.playerId, player.id));
    const periods = ['daily', 'weekly', 'monthly'];
    return { periods: periods.map((period) => questPeriodPublic(period, rows)), serverTime: new Date().toISOString() };
  });

  app.post('/api/quests/:questId/claim', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const questId = String((req.params as any).questId);
    const quest = (await db.select().from(schema.playerQuests).where(and(eq(schema.playerQuests.id, questId), eq(schema.playerQuests.playerId, player.id))))[0];
    if (!quest) throw new AppError('QUEST_NOT_FOUND', '任务不存在。');
    if (quest.status !== 'completed') throw new AppError('QUEST_NOT_COMPLETED', '任务尚未完成。');

    await db.transaction(async (tx) => {
      await tx.update(schema.playerQuests).set({ status: 'claimed', claimedAt: new Date() }).where(eq(schema.playerQuests.id, quest.id));
      await tx.update(schema.players).set({
        gold: sql`${schema.players.gold} + ${quest.rewardGold}`,
        relics: sql`${schema.players.relics} + ${quest.rewardRelics}`,
      }).where(eq(schema.players.id, player.id));
    });
    const rows = await db.select().from(schema.playerQuests).where(eq(schema.playerQuests.playerId, player.id));
    return {
      periods: ['daily', 'weekly', 'monthly'].map((period) => questPeriodPublic(period, rows)),
      player: shortPlayer(player.id),
      serverTime: new Date().toISOString(),
    };
  });

  app.post('/api/quests/:periodType/reroll', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const periodType = z.enum(['daily', 'weekly', 'monthly']).parse((req.params as any).periodType);
    const body = z.object({ periodKey: z.string().min(1).max(32) }).parse(req.body as any);
    const periodInfo = periodInfoFor(periodType);
    if (body.periodKey !== periodInfo.key) throw new AppError('QUEST_PERIOD_EXPIRED', '当前任务周期已经结束，请刷新后重试。');
    if (player.gold < QUEST_REROLL_COST) throw new AppError('QUEST_REROLL_INSUFFICIENT_GOLD', '金币不足，任务没有发生变化。');

    const [current, templates] = await Promise.all([
      db.select().from(schema.playerQuests).where(and(
        eq(schema.playerQuests.playerId, player.id),
        eq(schema.playerQuests.period, periodType),
        eq(schema.playerQuests.periodKey, periodInfo.key),
      )),
      db.select().from(schema.questTemplates).where(eq(schema.questTemplates.period, periodType)),
    ]);
    if (current.length === 0) throw new AppError('QUEST_REROLL_UNAVAILABLE', '当前没有可重随的任务。');
    if (current.every((quest) => quest.status === 'claimed')) throw new AppError('QUESTS_ALREADY_COMPLETED', '本周期任务已全部完成，无法重随。');

    const usedTemplates = new Set<string>();
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${QUEST_REROLL_COST}` }).where(eq(schema.players.id, player.id));
      for (const quest of current.sort((a, b) => a.slot - b.slot)) {
        if (quest.status === 'claimed') {
          if (quest.templateId) usedTemplates.add(quest.templateId);
          continue;
        }
        const choices = templates.filter((template) => !usedTemplates.has(template.id));
        const template = choices[Math.floor(Math.random() * choices.length)] ?? templates.find((item) => !usedTemplates.has(item.id));
        if (!template) throw new AppError('QUEST_REROLL_UNAVAILABLE', '可用任务模板不足，无法重随。');
        usedTemplates.add(template.id);
        await tx.update(schema.playerQuests).set({
          templateId: template.id,
          ...questFromTemplate(template),
          periodKey: periodInfo.key,
          progress: 0,
          status: 'in_progress',
          completedAt: null,
          claimedAt: null,
        }).where(eq(schema.playerQuests.id, quest.id));
      }
    });

    const [rows, updated] = await Promise.all([
      db.select().from(schema.playerQuests).where(eq(schema.playerQuests.playerId, player.id)),
      db.select().from(schema.players).where(eq(schema.players.id, player.id)),
    ]);
    return {
      period: questPeriodPublic(periodType, rows),
      gold: updated[0].gold,
      serverTime: new Date().toISOString(),
    };
  });

  app.get('/api/achievements', async (req, reply) => {
    const player = await requireAuth(req, reply);
    await syncAchievements(player.id);
    const [defs, progress] = await Promise.all([
      db.select().from(schema.achievementDefinitions),
      db.select().from(schema.playerAchievements).where(eq(schema.playerAchievements.playerId, player.id)),
    ]);
    const progMap = new Map(progress.map((p) => [p.achievementId, p]));
    const titles = await db.select().from(schema.titles);
    const titleMap = new Map(titles.map((t) => [t.id, t.name]));
    const seriesDefs = await db.select().from(schema.achievementDefinitions);
    const seriesNames = new Map(seriesDefs.filter((s) => s.seriesId).map((s) => [s.seriesId, s.seriesId]));
    const achievements = defs.map((d) => {
      const rec = progMap.get(d.id);
      return {
        id: d.id,
        version: d.version,
        category: d.category,
        name: d.name,
        description: d.description,
        progress: rec?.progress ?? 0,
        threshold: d.threshold,
        status: rec?.status ?? 'in_progress',
        reward: {
          relics: d.rewardRelics,
          title: d.titleId ? { id: d.titleId, name: titleMap.get(d.titleId) ?? d.titleId } : null,
        },
        claimedAt: rec?.claimedAt?.toISOString() ?? null,
        series: d.seriesId ? {
          id: d.seriesId,
          name: d.seriesName ?? seriesNames.get(d.seriesId) ?? '成就系列',
          step: d.seriesStep,
          totalSteps: d.seriesTotalSteps,
        } : null,
      };
    });
    const claimed = achievements.filter((a) => a.status === 'claimed').length;
    const claimable = achievements.filter((a) => a.status === 'claimable').length;
    return {
      achievements,
      summary: { claimed, claimable, total: achievements.length },
      serverTime: new Date().toISOString(),
    };
  });

  app.post('/api/achievements/:achievementId/claim', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const achievementId = String((req.params as any).achievementId);
    const rec = (await db.select().from(schema.playerAchievements).where(and(
      eq(schema.playerAchievements.playerId, player.id),
      eq(schema.playerAchievements.achievementId, achievementId),
    )))[0];
    if (!rec || rec.status !== 'claimable') throw new AppError('ACHIEVEMENT_NOT_CLAIMABLE', '该成就暂不可领取。');
    const def = (await db.select().from(schema.achievementDefinitions).where(eq(schema.achievementDefinitions.id, achievementId)))[0];
    if (!def) throw new AppError('ACHIEVEMENT_NOT_FOUND', '成就不存在。');

    await db.transaction(async (tx) => {
      await tx.update(schema.playerAchievements).set({ status: 'claimed', claimedAt: new Date() }).where(and(
        eq(schema.playerAchievements.playerId, player.id),
        eq(schema.playerAchievements.achievementId, achievementId),
      ));
      await tx.update(schema.players).set({ relics: sql`${schema.players.relics} + ${def.rewardRelics}` }).where(eq(schema.players.id, player.id));
    });
    const [updatedRec, titles, allTitles, playerRow] = await Promise.all([
      db.select().from(schema.playerAchievements).where(and(
        eq(schema.playerAchievements.playerId, player.id),
        eq(schema.playerAchievements.achievementId, achievementId),
      )),
      buildTitles(player.id),
      db.select().from(schema.titles),
      db.select().from(schema.players).where(eq(schema.players.id, player.id)),
    ]);
    return {
      achievement: achievementPublic(def, updatedRec[0], new Map(allTitles.map((title) => [title.id, title.name]))),
      titles,
      relics: playerRow[0].relics,
      serverTime: new Date().toISOString(),
    };
  });

  app.post('/api/achievements/claim-all', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const claimable = await db.select().from(schema.playerAchievements).where(and(
      eq(schema.playerAchievements.playerId, player.id),
      eq(schema.playerAchievements.status, 'claimable'),
    ));
    let relics = 0;
    const definitions = new Map((await db.select().from(schema.achievementDefinitions)).map((definition) => [definition.id, definition]));
    await db.transaction(async (tx) => {
      for (const rec of claimable) {
        const definition = definitions.get(rec.achievementId);
        relics += definition?.rewardRelics ?? 0;
        await tx.update(schema.playerAchievements).set({ status: 'claimed', claimedAt: new Date() }).where(and(
          eq(schema.playerAchievements.playerId, player.id),
          eq(schema.playerAchievements.achievementId, rec.achievementId),
        ));
      }
      if (relics > 0) await tx.update(schema.players).set({ relics: sql`${schema.players.relics} + ${relics}` }).where(eq(schema.players.id, player.id));
    });
    const [progressRows, titles, allTitles, playerRow] = await Promise.all([
      db.select().from(schema.playerAchievements).where(eq(schema.playerAchievements.playerId, player.id)),
      buildTitles(player.id),
      db.select().from(schema.titles),
      db.select().from(schema.players).where(eq(schema.players.id, player.id)),
    ]);
    const titleMap = new Map(allTitles.map((title) => [title.id, title.name]));
    const claimedIds = new Set(claimable.map((item) => item.achievementId));
    return {
      achievements: progressRows
        .filter((row) => claimedIds.has(row.achievementId))
        .map((row) => {
          const definition = definitions.get(row.achievementId);
          return definition ? achievementPublic(definition, row, titleMap) : null;
        })
        .filter(Boolean),
      titles,
      relics: playerRow[0].relics,
      serverTime: new Date().toISOString(),
    };
  });

  app.get('/api/mastery', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const [biomes, playerBiomes, targets, progress, inventory] = await Promise.all([
      db.select().from(schema.biomes).orderBy(schema.biomes.orderIndex),
      db.select().from(schema.playerBiomes).where(eq(schema.playerBiomes.playerId, player.id)),
      db.select().from(schema.masteryTargets),
      db.select().from(schema.playerMasteryProgress).where(eq(schema.playerMasteryProgress.playerId, player.id)),
      db.select().from(schema.playerInventoryFish).where(eq(schema.playerInventoryFish.playerId, player.id)),
    ]);
    const progMap = new Map(progress.map((p) => [p.targetId, p]));
    const invMap = new Map(inventory.map((i) => [i.fishId, i]));
    const fishDefs = await db.select().from(schema.fish);
    const fishMap = new Map(fishDefs.map((f) => [f.id, f]));

    let totalLevel = 0;
    const biomeList = [];
    for (const b of biomes) {
      const pb = playerBiomes.find((x) => x.biomeId === b.id);
      const rarities = [];
      let biomeLevel = pb?.masteryLevel ?? 0;
      totalLevel += biomeLevel;
      for (const rarity of ['common', 'uncommon', 'fine', 'rare', 'epic', 'legendary', 'mythic', 'exotic', 'arcane']) {
        const target = targets.filter((t) => t.biomeId === b.id && t.rarity === rarity).sort((a, b) => a.levelIndex - b.levelIndex);
        if (!target.length) continue;
        const t = target[0];
        const rec = progMap.get(t.id);
        const fish = fishMap.get(t.fishId);
        const inv = invMap.get(t.fishId);
        rarities.push({
          rarity,
          rarityName: rarityNameOf(rarity),
          completedLevel: rec?.completedLevel ?? 0,
          targetLevel: (rec?.completedLevel ?? 0) + 1,
          isWaiting: false,
          fish: fish ? { id: fish.id, name: fish.name, imagePath: fish.imagePath } : null,
          requiredQuantity: t.requiredQuantity,
          contributedQuantity: rec?.contributedQuantity ?? 0,
          remainingQuantity: Math.max(0, t.requiredQuantity - (rec?.contributedQuantity ?? 0)),
          availableQuantity: inv?.quantity ?? 0,
          isFishLocked: inv?.isLocked ?? false,
          xpBonusBasisPoints: (rec?.completedLevel ?? 0) * t.xpBonusBasisPointsPerLevel,
          directGoldBonusBasisPoints: (rec?.completedLevel ?? 0) * t.directGoldBonusBasisPointsPerLevel,
        });
      }
      biomeList.push({
        biomeId: b.id,
        biomeName: b.name,
        requiredLevel: b.requiredLevel,
        isUnlocked: pb?.isUnlocked ?? false,
        masteryLevel: biomeLevel,
        xpBonusBasisPoints: pb?.xpBonusBasisPoints ?? 0,
        directGoldBonusBasisPoints: pb?.directGoldBonusBasisPoints ?? 0,
        rarities,
      });
    }
    return {
      points: { earned: totalLevel, spent: totalLevel, available: 0 },
      totalLevel,
      highestBiomeLevel: Math.max(0, ...biomeList.map((b) => b.masteryLevel)),
      biomes: biomeList,
      serverTime: new Date().toISOString(),
    };
  });

  app.post('/api/mastery/:targetId/contribute', async (req, reply) => {
    const player = await requireAuth(req, reply);
    return contributeMastery(player.id, String((req.params as any).targetId), Math.max(1, Number((req.body as any)?.quantity ?? 1)));
  });

  app.post('/api/mastery/:biomeId/requirements/:rarity/contribute', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const biomeId = String((req.params as any).biomeId);
    const rarity = String((req.params as any).rarity);
    const quantity = Math.max(1, Number((req.body as any)?.quantity ?? 1));
    const targets = await db.select().from(schema.masteryTargets).where(and(eq(schema.masteryTargets.biomeId, biomeId), eq(schema.masteryTargets.rarity, rarity))).orderBy(asc(schema.masteryTargets.levelIndex));
    const progress = await db.select().from(schema.playerMasteryProgress).where(eq(schema.playerMasteryProgress.playerId, player.id));
    const map = new Map(progress.map((row) => [row.targetId, row]));
    const target = targets.find((item) => (map.get(item.id)?.completedLevel ?? 0) < item.maxLevel);
    if (!target) throw new AppError('TARGET_NOT_FOUND', '专精目标不存在或已完成。');
    return contributeMastery(player.id, target.id, quantity);
  });

  app.post('/api/mastery/:biomeId/contribute-all', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const biomeId = String((req.params as any).biomeId);
    const excluded = new Set<string>(Array.isArray((req.body as any)?.excludedRarities) ? (req.body as any).excludedRarities : []);
    const targets = await db.select().from(schema.masteryTargets).where(eq(schema.masteryTargets.biomeId, biomeId)).orderBy(asc(schema.masteryTargets.levelIndex));
    const progress = await db.select().from(schema.playerMasteryProgress).where(eq(schema.playerMasteryProgress.playerId, player.id));
    const map = new Map(progress.map((row) => [row.targetId, row]));
    let totalContributed = 0;
    for (const target of targets) {
      if (excluded.has(target.rarity) || (map.get(target.id)?.completedLevel ?? 0) >= target.maxLevel) continue;
      const inv = (await db.select().from(schema.playerInventoryFish).where(and(eq(schema.playerInventoryFish.playerId, player.id), eq(schema.playerInventoryFish.fishId, target.fishId))))[0];
      if (!inv || inv.quantity <= 0) continue;
      const result = await contributeMastery(player.id, target.id, inv.quantity);
      totalContributed += Number(result.contributed ?? 0);
    }
    return { success: true, contributed: totalContributed, serverTime: new Date().toISOString() };
  });

  app.get('/api/mastery/talents', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const [talents, playerTalents] = await Promise.all([
      db.select().from(schema.talents).orderBy(schema.talents.orderIndex),
      db.select().from(schema.playerTalents).where(eq(schema.playerTalents.playerId, player.id)),
    ]);
    const rankMap = new Map(playerTalents.map((t) => [t.talentId, t.rank]));
    const points = { earned: 0, spent: 0, available: 0 };
    for (const t of talents) {
      const rank = rankMap.get(t.id) ?? 0;
      points.spent += upgradeCostFor(rank);
      points.available -= upgradeCostFor(rank);
    }
    points.available = Math.max(0, points.earned - points.spent);
    void points.spent;

    return {
      points: { earned: 0, spent: 0, available: 0 },
      talents: talents.map((t) => {
        const rank = rankMap.get(t.id) ?? 0;
        const eff = typeof t.effectPerRank === 'number' ? t.effectPerRank * rank : t.effectPerRank;
        const nextEff = typeof t.effectPerRank === 'number' ? t.effectPerRank * (rank + 1) : t.effectPerRank;
        const prereqOk = !t.prerequisiteTalentId || (rankMap.get(t.prerequisiteTalentId) ?? 0) >= (t.prerequisiteRank ?? 0);
        return {
          id: t.id,
          name: t.name,
          description: t.description,
          rank,
          effectKind: t.effectKind,
          effectPerRank: t.effectPerRank,
          currentEffect: eff,
          nextEffect: nextEff,
          upgradeCost: upgradeCostFor(rank + 1) - upgradeCostFor(rank),
          prerequisiteTalentId: t.prerequisiteTalentId,
          prerequisiteRank: t.prerequisiteRank,
          canUpgrade: prereqOk,
          blockedReason: !prereqOk ? 'prerequisite' : 'points',
        };
      }),
      reset: { cost: { gold: 50000000, fragments: 2500 }, canReset: false },
      serverTime: new Date().toISOString(),
    };
  });

  app.post('/api/mastery/talents/:talentId/upgrade', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const talentId = String((req.params as any).talentId);
    const talent = (await db.select().from(schema.talents).where(eq(schema.talents.id, talentId)))[0];
    if (!talent) throw new AppError('TALENT_NOT_FOUND', '天赋不存在。');
    const rec = (await db.select().from(schema.playerTalents).where(and(eq(schema.playerTalents.playerId, player.id), eq(schema.playerTalents.talentId, talentId))))[0];
    const rank = rec?.rank ?? 0;
    if (rank >= talent.maxRank) throw new AppError('TALENT_MAX', '该天赋已满级。');
    // only if points available (server awards points on mastery levels); here auto-award 1 point per upgrade with gold cost
    const cost = 500000;
    if (player.gold < cost) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${cost}` }).where(eq(schema.players.id, player.id));
      await tx.insert(schema.playerTalents).values({ playerId: player.id, talentId, rank: rank + 1 })
        .onConflictDoUpdate({ target: [schema.playerTalents.playerId, schema.playerTalents.talentId], set: { rank: rank + 1 } });
    });
    return { success: true };
  });

  app.post('/api/mastery/talents/reset', async (req, reply) => {
    const player = await requireAuth(req, reply);
    if (player.gold < 50000000) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    if (player.fragments < 2500) throw new AppError('INSUFFICIENT_FRAGMENTS', '奥秘碎片不足。');
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({
        gold: sql`${schema.players.gold} - 50000000`,
        fragments: sql`${schema.players.fragments} - 2500`,
      }).where(eq(schema.players.id, player.id));
      await tx.update(schema.playerTalents).set({ rank: 0 }).where(eq(schema.playerTalents.playerId, player.id));
    });
    return { success: true };
  });
}

function questFromTemplate(t: typeof schema.questTemplates.$inferSelect) {
  let biomeName: string | null = null;
  if (t.biomeId) {
    const names: Record<string, string> = {
      b_001: '月落溪谷', b_002: '雾语湿地', b_003: '镜潮海岸', b_004: '雷痕峡湾', b_005: '星根洞窟',
      b_006: '霞栖湖原', b_007: '云汐悬湖', b_008: '赤砂涌泉', b_009: '极昼冰湾', b_010: '沉钟古港',
      b_011: '翡翠洪林', b_012: '熔潮环礁', b_013: '天穹鲸海', b_014: '时镜回流', b_015: '星渊圣海',
    };
    biomeName = names[t.biomeId] ?? t.biomeId;
  }
  const baitName = t.baitTier ? baitTierName(t.baitTier) : null;
  return {
    category: t.category,
    objectiveType: t.objectiveType,
    description: t.descriptionTemplate
      .replace('{target}', t.target.toLocaleString('zh-CN'))
      .replace('{biome}', biomeName ?? '')
      .replace('{weather}', weatherName(t.weatherId) ?? '')
      .replace('{baittier}', baitName ?? ''),
    target: t.target,
    rewardRelics: t.rewardRelics,
    rewardGold: t.rewardGold,
    biomeId: t.biomeId,
    biomeName,
    isBiomeUnlocked: t.biomeId ? true : null,
    weatherId: t.weatherId,
    weatherName: weatherName(t.weatherId),
    baitId: t.baitTier ? 'bait_' + t.baitTier : null,
    baitName,
    rarity: t.rarity,
    rarityName: t.rarity ? rarityNameOf(t.rarity) : null,
    settlementMode: t.settlementMode,
  };
}

function baitTierName(tier: string): string {
  const map: Record<string, string> = { basic: '基础饵', low: '低级饵', medium: '中级饵', high: '高级饵', supreme: '顶级饵' };
  return map[tier] ?? tier;
}

function weatherName(id: string | null): string | null {
  if (!id) return null;
  const map: Record<string, string> = {
    clear: '晴朗', rain: '雨幕', gale: '强风', mist: '浓雾', heatwave: '热浪',
    tempest: '雷暴', wither_tide: '枯潮', gilded_current: '金风', arcane_surge: '奥秘涌流',
  };
  return map[id] ?? id;
}

function rarityNameOf(id: string): string {
  const map: Record<string, string> = {
    common: '普通', uncommon: '罕见', fine: '精良', rare: '稀有', epic: '史诗',
    legendary: '传说', mythic: '神话', exotic: '奇异', arcane: '奥秘',
  };
  return map[id] ?? id;
}

function upgradeCostFor(rank: number): number {
  if (rank <= 0) return 0;
  if (rank <= 2) return rank;
  if (rank <= 5) return 2;
  return 3;
}

function periodInfoFor(period: string) {
  const now = new Date();
  const china = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  const today = `${china.getUTCFullYear()}-${p(china.getUTCMonth() + 1)}-${p(china.getUTCDate())}`;
  if (period === 'daily') {
    return {
      key: today,
      startsAt: new Date(Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate(), 0, 0, 0) - 8 * 3600 * 1000),
      endsAt: new Date(Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate() + 1, 0, 0, 0) - 8 * 3600 * 1000),
    };
  }
  if (period === 'weekly') {
    const monday = new Date(Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate() - ((china.getUTCDay() + 6) % 7), 0, 0, 0) - 8 * 3600 * 1000);
    return {
      key: monday.toISOString().slice(0, 10),
      startsAt: monday,
      endsAt: new Date(monday.getTime() + 7 * 24 * 3600 * 1000),
    };
  }
  return {
    key: today.slice(0, 7),
    startsAt: new Date(Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), 1, 0, 0, 0) - 8 * 3600 * 1000),
    endsAt: new Date(Date.UTC(china.getUTCFullYear(), china.getUTCMonth() + 1, 1, 0, 0, 0) - 8 * 3600 * 1000),
  };
}

function achievementPublic(
  definition: typeof schema.achievementDefinitions.$inferSelect,
  record: typeof schema.playerAchievements.$inferSelect,
  titleMap: Map<string, string>,
) {
  return {
    id: definition.id,
    version: definition.version,
    category: definition.category,
    name: definition.name,
    description: definition.description,
    progress: record?.progress ?? 0,
    threshold: definition.threshold,
    status: record?.status ?? 'in_progress',
    reward: {
      relics: definition.rewardRelics,
      title: definition.titleId ? { id: definition.titleId, name: titleMap.get(definition.titleId) ?? definition.titleId } : null,
    },
    claimedAt: record?.claimedAt?.toISOString() ?? null,
    series: definition.seriesId ? {
      id: definition.seriesId,
      name: definition.seriesName ?? '成就系列',
      step: definition.seriesStep,
      totalSteps: definition.seriesTotalSteps,
    } : null,
  };
}

function questPeriodPublic(period: string, rows: (typeof schema.playerQuests.$inferSelect)[]) {
  const info = periodInfoFor(period);
  const tasks = rows
    .filter((row) => row.period === period && row.periodKey === info.key)
    .sort((a, b) => a.slot - b.slot);
  const completedCount = tasks.filter((task) => task.status === 'claimed').length;
  return {
    type: period,
    key: info.key,
    startsAt: info.startsAt.toISOString(),
    endsAt: info.endsAt.toISOString(),
    completedCount,
    totalCount: tasks.length,
    canReroll: tasks.length > 0 && completedCount < tasks.length,
    rerollGoldCost: QUEST_REROLL_COST,
    tasks: tasks.map(questPublic),
  };
}

function questPublic(q: typeof schema.playerQuests.$inferSelect) {
  return {
    id: q.id,
    slot: q.slot,
    category: q.category,
    objectiveType: q.objectiveType,
    description: q.description,
    target: q.target,
    progress: q.progress,
    rewardRelics: q.rewardRelics,
    status: q.status,
    completedAt: q.completedAt?.toISOString() ?? null,
    biomeId: q.biomeId,
    biomeName: q.biomeName,
    isBiomeUnlocked: q.isBiomeUnlocked,
    weatherId: q.weatherId,
    weatherName: q.weatherName,
    baitId: q.baitId,
    baitName: q.baitName,
    rarity: q.rarity,
    rarityName: q.rarityName,
    settlementMode: q.settlementMode,
  };
}

async function ensureQuests(playerId: string) {
  for (const period of ['daily', 'weekly', 'monthly']) {
    const info = periodInfoFor(period);
    const existing = await db.select().from(schema.playerQuests).where(and(
      eq(schema.playerQuests.playerId, playerId),
      eq(schema.playerQuests.period, period),
      eq(schema.playerQuests.periodKey, info.key),
    ));
    if (existing.length > 0) continue;
    const templates = await db.select().from(schema.questTemplates).where(eq(schema.questTemplates.period, period));
    for (const t of templates) {
      await db.insert(schema.playerQuests).values({
        playerId,
        period,
        periodKey: info.key,
        slot: t.slot,
        templateId: t.id,
        ...questFromTemplate(t),
      });
    }
  }
}

async function syncAchievements(playerId: string) {
  const player = (await db.select().from(schema.players).where(eq(schema.players.id, playerId)))[0];
  const [defs, progress] = await Promise.all([
    db.select().from(schema.achievementDefinitions),
    db.select().from(schema.playerAchievements).where(eq(schema.playerAchievements.playerId, playerId)),
  ]);
  const progMap = new Map(progress.map((p) => [p.achievementId, p]));

  for (const d of defs) {
    const rec = progMap.get(d.id);
    if (rec && rec.status === 'claimed') continue;
    const value = await achievementValue(playerId, d.id, player);
    if (!rec && value >= d.threshold) {
      await db.insert(schema.playerAchievements).values({ playerId, achievementId: d.id, progress: value, status: 'claimable' })
        .onConflictDoNothing();
    } else if (rec && value >= d.threshold && rec.status === 'in_progress') {
      await db.update(schema.playerAchievements).set({ progress: value, status: 'claimable' }).where(and(eq(schema.playerAchievements.playerId, playerId), eq(schema.playerAchievements.achievementId, d.id)));
    } else if (rec && rec.status === 'in_progress' && value > rec.progress) {
      await db.update(schema.playerAchievements).set({ progress: value }).where(and(eq(schema.playerAchievements.playerId, playerId), eq(schema.playerAchievements.achievementId, d.id)));
    }
  }
}

async function achievementValue(playerId: string, achievementId: string, player: typeof schema.players.$inferSelect): Promise<number> {
  const [stats, weatherCasts, baitCasts, biomeCasts, inv, biomes, playerBiomes, mastery, rods, fishRows] = await Promise.all([
    db.select().from(schema.playerStats).where(eq(schema.playerStats.playerId, playerId)),
    db.select().from(schema.playerWeatherCasts).where(eq(schema.playerWeatherCasts.playerId, playerId)),
    db.select().from(schema.playerBaitCasts).where(eq(schema.playerBaitCasts.playerId, playerId)),
    db.select().from(schema.playerBiomeCasts).where(eq(schema.playerBiomeCasts.playerId, playerId)),
    db.select().from(schema.playerInventoryFish).where(eq(schema.playerInventoryFish.playerId, playerId)),
    db.select().from(schema.biomes),
    db.select().from(schema.playerBiomes).where(eq(schema.playerBiomes.playerId, playerId)),
    db.select().from(schema.playerMasteryProgress).where(eq(schema.playerMasteryProgress.playerId, playerId)),
    db.select().from(schema.playerRods).where(eq(schema.playerRods.playerId, playerId)),
    db.select().from(schema.fish),
  ]);

  const s = stats[0];
  const wMap = new Map(weatherCasts.map((x) => [x.weatherId, x.casts]));
  const bMap = new Map(baitCasts.map((x) => [x.baitId, x.casts]));
  const bcMap = new Map(biomeCasts.map((x) => [x.biomeId, x.casts]));
  const invList = inv.filter((x) => x.totalCaught > 0);
  const unlocked = playerBiomes.filter((x) => x.isUnlocked).length;
  const masteryTotal = mastery.reduce((sum, m) => sum + (m.completedLevel ?? 0), 0);
  const rodTotalLevels = rods.reduce((sum, r) => sum + Math.max(0, r.level - 1), 0);
  const discoveredByBiome = new Map<string, number>();
  const fishDefMap = new Map(fishRows.map((f) => [f.id, f]));
  const biomeFishCount = new Map<string, number>();
  for (const f of fishRows) biomeFishCount.set(f.biomeId, (biomeFishCount.get(f.biomeId) ?? 0) + 1);
  for (const i of invList) {
    const def = fishDefMap.get(i.fishId);
    if (def) discoveredByBiome.set(def.biomeId, (discoveredByBiome.get(def.biomeId) ?? 0) + 1);
  }

  let m = achievementId.match(/^casts_(\d+)$/); if (m) return player.totalCasts;
  m = achievementId.match(/^level_(\d+)$/); if (m) return player.level;
  m = achievementId.match(/^fish_(\d+)$/); if (m) return player.totalFishCaught;
  m = achievementId.match(/^login_days_(\d+)$/); if (m) return s?.loginDays ?? 0;
  m = achievementId.match(/^discover_(\d+)$/); if (m) return invList.length;
  m = achievementId.match(/^npc_sell_(\d+)$/); if (m) return player.npcFishSoldQuantity;
  m = achievementId.match(/^online_casts_(\d+)$/); if (m) return s?.onlineCasts ?? 0;
  m = achievementId.match(/^offline_casts_(\d+)$/); if (m) return s?.offlineCasts ?? 0;
  m = achievementId.match(/^fishing_relics_(\d+)$/); if (m) return player.totalRelicQuantity;
  m = achievementId.match(/^chests_dropped_(\d+)$/); if (m) return player.totalChestsDropped;
  m = achievementId.match(/^gear_dropped_(\d+)$/); if (m) return player.totalGearDropped;
  m = achievementId.match(/^chests_opened_(\d+)$/); if (m) return player.totalChestsOpened;
  m = achievementId.match(/^gear_upgrade_(\d+)$/); if (m) return player.totalGearUpgrades;
  m = achievementId.match(/^market_trade_(\d+)$/); if (m) return s?.marketTrades ?? 0;
  m = achievementId.match(/^personal_tournaments_(\d+)$/); if (m) return s?.personalTournaments ?? 0;
  m = achievementId.match(/^guild_tournaments_(\d+)$/); if (m) return s?.guildTournaments ?? 0;
  m = achievementId.match(/^mastery_(\d+)$/); if (m) return masteryTotal;
  m = achievementId.match(/^rod_level_(\d+)$/); if (m) return rodTotalLevels;
  m = achievementId.match(/^biomes_(\d+)$/); if (m) return unlocked;
  m = achievementId.match(/^weather_(\w+)_casts_(\d+)$/); if (m) return wMap.get(m[1]) ?? 0;
  m = achievementId.match(/^bait_(\w+)_casts_(\d+)$/); if (m) return bMap.get('bait_' + m[1]) ?? 0;
  m = achievementId.match(/^biome_b_(\d+)_casts_(\d+)$/); if (m) return bcMap.get('b_' + m[1]) ?? 0;
  m = achievementId.match(/^biome_b_(\d+)_collection_(\d+)$/); if (m) return discoveredByBiome.get('b_' + m[1]) ?? 0;
  m = achievementId.match(/^first_(legendary|mythic|exotic|arcane)$/); if (m) {
    const key = ('first' + m[1][0].toUpperCase() + m[1].slice(1) + 'At') as 'firstLegendaryAt';
    return s?.[key] ? 1 : 0;
  }
  switch (achievementId) {
    case 'capital_has_entered': return 1;
    case 'moonfall_complete': return (discoveredByBiome.get('b_001') ?? 0) >= (biomeFishCount.get('b_001') ?? 66) ? 1 : 0;
    case 'all_biomes_complete': {
      let complete = true;
      for (const [biomeId, total] of biomeFishCount) {
        if ((discoveredByBiome.get(biomeId) ?? 0) < total) { complete = false; break; }
      }
      return complete ? 1 : 0;
    }
    default: return player.totalCasts;
  }
}

async function buildTitles(playerId: string) {
  const [defs, progress] = await Promise.all([
    db.select().from(schema.achievementDefinitions),
    db.select().from(schema.playerAchievements).where(eq(schema.playerAchievements.playerId, playerId)),
  ]);
  const claimed = new Set(progress.filter((p) => p.status === 'claimed').map((p) => p.achievementId));
  const titleIds = defs.filter((d) => d.titleId && claimed.has(d.id)).map((d) => d.titleId!);
  const titles = await db.select().from(schema.titles);
  const titleMap = new Map(titles.map((t) => [t.id, t]));
  return {
    titles: titleIds.map((id) => {
      const t = titleMap.get(id);
      return t ? { id: t.id, name: t.name, description: t.description, imagePath: t.imagePath, isUnlocked: true, isEquipped: false } : null;
    }).filter(Boolean),
  };
}

async function shortPlayer(playerId: string) {
  const p = (await db.select().from(schema.players).where(eq(schema.players.id, playerId)))[0];
  return (await buildSession(p)).player;
}

async function contributeMastery(playerId: string, targetId: string, qty: number) {
  const [targetRows, rec, fishRows] = await Promise.all([
    db.select().from(schema.masteryTargets).where(eq(schema.masteryTargets.id, targetId)),
    db.select().from(schema.playerMasteryProgress).where(and(eq(schema.playerMasteryProgress.playerId, playerId), eq(schema.playerMasteryProgress.targetId, targetId))),
    db.select().from(schema.fish),
  ]);
  const target = targetRows[0];
  if (!target) throw new AppError('TARGET_NOT_FOUND', '专精目标不存在。');
  const inv = (await db.select().from(schema.playerInventoryFish).where(and(eq(schema.playerInventoryFish.playerId, playerId), eq(schema.playerInventoryFish.fishId, target.fishId))))[0];
  const currentContributed = Number(rec[0]?.contributedQuantity ?? 0);
  const canAdd = Math.min(qty, inv?.quantity ?? 0, Math.max(0, Number(target.requiredQuantity) - currentContributed));
  if (canAdd <= 0) throw new AppError('INSUFFICIENT_FISH', '鱼获数量不足。');
  await db.transaction(async (tx) => {
    await tx.update(schema.playerInventoryFish).set({ quantity: (inv?.quantity ?? 0) - canAdd }).where(and(eq(schema.playerInventoryFish.playerId, playerId), eq(schema.playerInventoryFish.fishId, target.fishId)));
    const current = (await tx.select().from(schema.playerMasteryProgress).where(and(eq(schema.playerMasteryProgress.playerId, playerId), eq(schema.playerMasteryProgress.targetId, target.id))))[0];
    const newTotal = Number(current?.contributedQuantity ?? 0) + canAdd;
    let completedLevel = current?.completedLevel ?? 0;
    let levelUps = 0;
    while (newTotal >= Number(target.requiredQuantity) * (completedLevel + 1) && completedLevel < target.maxLevel) {
      completedLevel += 1;
      levelUps += 1;
    }
    await tx.insert(schema.playerMasteryProgress).values({ playerId, targetId: target.id, contributedQuantity: newTotal, completedLevel })
      .onConflictDoUpdate({ target: [schema.playerMasteryProgress.playerId, schema.playerMasteryProgress.targetId], set: { contributedQuantity: newTotal, completedLevel } });
    if (levelUps > 0) {
      const playerBiome = (await tx.select().from(schema.playerBiomes).where(and(eq(schema.playerBiomes.playerId, playerId), eq(schema.playerBiomes.biomeId, target.biomeId))))[0];
      const newLevel = (playerBiome?.masteryLevel ?? 0) + levelUps;
      await tx.update(schema.playerBiomes).set({ masteryLevel: newLevel, xpBonusBasisPoints: newLevel * 250, directGoldBonusBasisPoints: newLevel * 250 }).where(and(eq(schema.playerBiomes.playerId, playerId), eq(schema.playerBiomes.biomeId, target.biomeId)));
    }
  });
  return { success: true, fishName: fishRows.find((fish) => fish.id === target.fishId)?.name ?? target.fishId, contributed: canAdd, serverTime: new Date().toISOString() };
}
