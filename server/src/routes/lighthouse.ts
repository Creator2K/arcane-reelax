import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { grantPlayerBuff } from '../services/buffs.js';
import { reincarnationConfigVersion, reincarnationLevelPoints, reincarnationTalentCost, validateReincarnationRanks } from '../services/reincarnationTalents.js';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { requireAuth } from '../services/auth.js';
import { AppError } from '../util/errors.js';
import { buildSession } from './auth.js';

const LOTTERY_COST = 1_000_000;
const LOTTERY_TEN_COST = LOTTERY_COST * 10;
const ARTIFACT_PITY_LIMIT = 30;
const EXOTIC_FISH_PER_DRAW = 3;
const LIGHTHOUSE_STEP_TARGET = 10_000_000;

const CURRENT_LOTTERY_POOL_VERSION = 'lighthouse-lottery-v1';
const LOTTERY_SETTING_KEY = 'lighthouse-lottery-state';

type LotteryReward = {
  category: 'fish' | 'gold' | 'relic' | 'chest' | 'artifact' | 'buff' | 'title';
  name: string;
  quantity?: number;
  chestId?: string;
  id?: string;
  level?: number;
  durationSeconds?: number;
  titleId?: string;
  rarity?: string;
};

type WeightedItem<T> = T & { weight: number };

const artifactLabels: Record<string, { effectPerLevel: string; maximumEffect: string }> = {
  strength_gift: { effectPerLevel: '力量 +5', maximumEffect: '力量 +2,500' },
  intelligence_gift: { effectPerLevel: '智力 +5', maximumEffect: '智力 +2,500' },
  luck_gift: { effectPerLevel: '运气 +5', maximumEffect: '运气 +2,500' },
  endurance_gift: { effectPerLevel: '耐力 +5', maximumEffect: '耐力 +2,500' },
  four_saints_power: { effectPerLevel: '全属性 +2', maximumEffect: '全属性 +1,000' },
  sea_king_gift: { effectPerLevel: '钓鱼直接金币上限 +3', maximumEffect: '上限 +1,500' },
  fortune_gift: { effectPerLevel: '钓鱼直接金币下限 +3', maximumEffect: '下限 +1,500' },
  experience_gift: { effectPerLevel: '经验获取 +0.2%', maximumEffect: '经验获取 +100%' },
  competition_banner: { effectPerLevel: '个人赛、公会赛得分 +0.05%', maximumEffect: '个人赛、公会赛得分 +25%' },
  strength_totem: { effectPerLevel: '总力量 +0.05%', maximumEffect: '总力量 +25%' },
  intelligence_totem: { effectPerLevel: '总智力 +0.05%', maximumEffect: '总智力 +25%' },
  luck_totem: { effectPerLevel: '总运气 +0.05%', maximumEffect: '总运气 +25%' },
  endurance_totem: { effectPerLevel: '总耐力 +0.05%', maximumEffect: '总耐力 +25%' },
};

const currentArtifactLabel: Record<string, string> = {
  strength: '力量', intelligence: '智力', luck: '运气', endurance: '耐力', all: '全属性',
  direct_gold_max: '钓鱼直接金币上限', direct_gold_min: '钓鱼直接金币下限',
};

const extraArtifactNames: Record<string, string> = {
  strength_gift: '力量恩赐',
  intelligence_gift: '智慧恩赐',
  luck_gift: '幸运恩赐',
  endurance_gift: '耐力恩赐',
  four_saints_power: '四圣之力',
  sea_king_gift: '海王恩赐',
  fortune_gift: '财运恩赐',
  experience_gift: '经验恩赐',
  competition_banner: '竞潮战旗',
  strength_totem: '力量图腾',
  intelligence_totem: '智慧图腾',
  luck_totem: '幸运图腾',
  endurance_totem: '耐力图腾',
};

const rarityNames: Record<string, string> = {
  common: '普通鱼获', uncommon: '罕见鱼获', fine: '精良鱼获', rare: '稀有鱼获',
  epic: '史诗鱼获', legendary: '传说鱼获', mythic: '神话鱼获', exotic: '奇异鱼获', arcane: '奥秘鱼获',
};

const lotteryCategories: WeightedItem<{ category: LotteryReward['category'] }>[] = [
  { category: 'fish', weight: 2200 },
  { category: 'gold', weight: 2000 },
  { category: 'relic', weight: 2000 },
  { category: 'chest', weight: 1950 },
  { category: 'artifact', weight: 800 },
  { category: 'buff', weight: 1000 },
  { category: 'title', weight: 50 },
];

const goldRewards: WeightedItem<{ quantity: number }>[] = [
  { quantity: 100_000, weight: 6985 }, { quantity: 500_000, weight: 2000 },
  { quantity: 1_000_000, weight: 600 }, { quantity: 2_000_000, weight: 250 },
  { quantity: 5_000_000, weight: 100 }, { quantity: 10_000_000, weight: 50 },
  { quantity: 20_000_000, weight: 10 }, { quantity: 50_000_000, weight: 5 },
];

const relicRewards: WeightedItem<{ quantity: number }>[] = [
  { quantity: 30, weight: 3435 }, { quantity: 50, weight: 3000 },
  { quantity: 100, weight: 1700 }, { quantity: 150, weight: 1000 },
  { quantity: 300, weight: 400 }, { quantity: 500, weight: 300 },
  { quantity: 800, weight: 100 }, { quantity: 1000, weight: 40 },
  { quantity: 5000, weight: 15 }, { quantity: 10000, weight: 10 },
];

const chestRewards: WeightedItem<{ chestId: string; name: string }>[] = [
  { chestId: 'mysterious_gear_chest', name: '神话宝箱', weight: 9000 },
  { chestId: 'arcane_gear_chest', name: '奥术宝箱', weight: 1000 },
];

const buffRewards: WeightedItem<{ buffType: string; name: string; bonusBasisPoints: number; durationSeconds: number }>[] = [
  { buffType: 'experience', name: '经验祝福', bonusBasisPoints: 2500, durationSeconds: 3600, weight: 3500 },
  { buffType: 'gold', name: '金币祝福', bonusBasisPoints: 2500, durationSeconds: 3600, weight: 3500 },
  { buffType: 'competition', name: '竞潮祝福', bonusBasisPoints: 1500, durationSeconds: 1800, weight: 3000 },
];

const fishRewards: WeightedItem<{ rarity: string; quantity: number }>[] = [
  { rarity: 'common', quantity: 500, weight: 3000 },
  { rarity: 'uncommon', quantity: 300, weight: 2500 },
  { rarity: 'fine', quantity: 100, weight: 2000 },
  { rarity: 'rare', quantity: 50, weight: 1200 },
  { rarity: 'epic', quantity: 10, weight: 700 },
  { rarity: 'legendary', quantity: 1, weight: 400 },
  { rarity: 'mythic', quantity: 1, weight: 150 },
  { rarity: 'exotic', quantity: 1, weight: 40 },
  { rarity: 'arcane', quantity: 1, weight: 10 },
];

const titleRewards: WeightedItem<{ titleId: string; name: string }>[] = [
  { titleId: 'lighthouse_keeper', name: '守灯人', weight: 5000 },
  { titleId: 'mist_sea_lantern_bearer', name: '雾海提灯者', weight: 3000 },
  { titleId: 'long_night_navigator', name: '长夜领航者', weight: 1500 },
  { titleId: 'undying_beacon', name: '不灭航标', weight: 500 },
];

function pickWeighted<T>(items: WeightedItem<T>[]): WeightedItem<T> | null {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (!items.length || total <= 0) return null;
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= Math.max(0, item.weight);
    if (roll < 0) return item;
  }
  return items[items.length - 1] ?? null;
}

function formatEffectNumber(value: number): string {
  return Number(value.toFixed(2)).toLocaleString('zh-CN');
}

function artifactCurrentEffect(def: typeof schema.lighthouseArtifacts.$inferSelect, level: number): string {
  const labels = artifactLabels[def.id];
  if (def.id === 'experience_gift') return `经验获取 +${formatEffectNumber(level * 0.2)}%`;
  if (def.id === 'competition_banner') return `个人赛、公会赛得分 +${formatEffectNumber(level * 0.05)}%`;
  if (def.id.endsWith('_totem')) return `总${currentArtifactLabel[def.statType.replace('_pct', '')]} +${formatEffectNumber(level * 0.05)}%`;
  if (def.statType === 'direct_gold_max') return `钓鱼直接金币上限 +${formatEffectNumber(level * def.baseBonus)}`;
  if (def.statType === 'direct_gold_min') return `钓鱼直接金币下限 +${formatEffectNumber(level * def.baseBonus)}`;
  if (def.statType === 'all') return `全属性 +${formatEffectNumber(level * def.baseBonus)}`;
  return `${currentArtifactLabel[def.statType] ?? labels?.effectPerLevel ?? '属性'} +${formatEffectNumber(level * def.baseBonus)}`;
}

function artifactUpgradeCost(base: number, growth: number, level: number) {
  return Math.ceil(base * Math.pow(growth, Math.max(0, level - 1)));
}

function rewardDisplayName(category: LotteryReward['category']): string {
  if (category === 'gold') return '金币';
  if (category === 'relic') return '遗物';
  return category;
}

function rewardFromDraw(
  draw: typeof schema.lighthouseLotteryDraws.$inferSelect,
  defs: (typeof schema.lighthouseArtifacts.$inferSelect)[],
  chests: (typeof schema.chests.$inferSelect)[],
  ownedTitleIds: Set<string>,
): LotteryReward {
  const artifact = draw.rewardId ? defs.find((item) => item.id === draw.rewardId) : undefined;
  if (draw.rewardType === 'artifact' || draw.rewardType === 'artifact_upgrade') {
    return {
      category: 'artifact',
      id: artifact?.id ?? draw.rewardId ?? undefined,
      name: artifact?.name ?? draw.rewardId ?? '神器',
      level: Math.max(1, draw.rewardAmount),
    };
  }
  if (draw.rewardType === 'gold') return { category: 'gold', name: '金币', quantity: draw.rewardAmount };
  if (draw.rewardType === 'relic') return { category: 'relic', name: '遗物', quantity: draw.rewardAmount };
  if (draw.rewardType === 'fish') return { category: 'fish', name: rarityNames[draw.rewardId ?? ''] ?? '鱼获', quantity: draw.rewardAmount };
  if (draw.rewardType === 'chest') {
    const chest = chests.find((item) => item.id === draw.rewardId);
    return { category: 'chest', name: chest?.name ?? '装备箱', chestId: draw.rewardId ?? undefined, quantity: 1 };
  }
  if (draw.rewardType === 'buff') {
    const buff = buffRewards.find((item) => item.buffType === draw.rewardId);
    return { category: 'buff', name: buff?.name ?? '个人祝福', durationSeconds: buff?.durationSeconds ?? 3600 };
  }
  if (draw.rewardType === 'title') {
    const title = titleRewards.find((item) => item.titleId === draw.rewardId);
    return { category: 'title', name: title?.name ?? '限定称号', titleId: draw.rewardId ?? undefined };
  }
  const fallbackCategory = draw.rewardType === 'relics' ? 'relic' : draw.rewardType;
  return { category: (lotteryCategories.find((item) => item.category === fallbackCategory)?.category ?? 'gold'), name: rewardDisplayName('gold'), quantity: draw.rewardAmount };
}

type LighthouseState = { totalContributedGold: number; currentStepGold: number; litUntil: string | null };

async function loadLighthouseState(): Promise<LighthouseState> {
  const row = (await db.select().from(schema.globalSettings).where(eq(schema.globalSettings.key, LOTTERY_SETTING_KEY)))[0];
  const stored = row?.value as Partial<LighthouseState> | undefined;
  return {
    totalContributedGold: Number(stored?.totalContributedGold ?? 0),
    currentStepGold: Number(stored?.currentStepGold ?? 0),
    litUntil: typeof stored?.litUntil === 'string' ? stored.litUntil : null,
  };
}

function advanceLighthouse(state: LighthouseState, contributedGold: number): LighthouseState {
  let currentStepGold = state.currentStepGold + contributedGold;
  let litUntilMs = state.litUntil ? Date.parse(state.litUntil) : Number.NaN;
  while (currentStepGold >= LIGHTHOUSE_STEP_TARGET) {
    currentStepGold -= LIGHTHOUSE_STEP_TARGET;
    const base = Number.isFinite(litUntilMs) ? Math.max(Date.now(), litUntilMs) : Date.now();
    litUntilMs = base + 30 * 60_000;
  }
  return {
    totalContributedGold: state.totalContributedGold + contributedGold,
    currentStepGold,
    litUntil: Number.isFinite(litUntilMs) ? new Date(litUntilMs).toISOString() : null,
  };
}

async function saveLighthouseState(state: LighthouseState) {
  await db.insert(schema.globalSettings).values({ key: LOTTERY_SETTING_KEY, value: state })
    .onConflictDoUpdate({ target: schema.globalSettings.key, set: { value: state, updatedAt: new Date() } });
}

async function loadOwnedLighthouseTitleIds(playerId: string): Promise<string[]> {
  const row = (await db.select().from(schema.globalSettings).where(eq(schema.globalSettings.key, `player-lighthouse-titles:${playerId}`)))[0];
  return Array.isArray(row?.value) ? row.value.filter((item): item is string => typeof item === 'string') : [];
}

async function saveOwnedLighthouseTitleIds(playerId: string, ids: string[]) {
  await db.insert(schema.globalSettings).values({ key: `player-lighthouse-titles:${playerId}`, value: [...new Set(ids)] })
    .onConflictDoUpdate({ target: schema.globalSettings.key, set: { value: [...new Set(ids)], updatedAt: new Date() } });
}

async function currentLotteryState(playerId: string) {
  const player = (await db.select().from(schema.players).where(eq(schema.players.id, playerId)))[0];
  if (!player) throw new AppError('PLAYER_NOT_FOUND', '玩家不存在。', 404);
  const [defs, owned, draws, drawCountRow, exoticRows, activeBuffs, chestRows, ownedTitleIds, lighthouseState] = await Promise.all([
    db.select().from(schema.lighthouseArtifacts).where(eq(schema.lighthouseArtifacts.isActive, true)).orderBy(asc(schema.lighthouseArtifacts.orderIndex)),
    db.select().from(schema.playerArtifacts).where(eq(schema.playerArtifacts.playerId, playerId)),
    db.select().from(schema.lighthouseLotteryDraws).where(eq(schema.lighthouseLotteryDraws.playerId, playerId)).orderBy(desc(schema.lighthouseLotteryDraws.createdAt)).limit(50),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.lighthouseLotteryDraws).where(eq(schema.lighthouseLotteryDraws.playerId, playerId)),
    db.select({ quantity: schema.playerInventoryFish.quantity, sellPrice: schema.fish.sellPrice })
      .from(schema.playerInventoryFish)
      .innerJoin(schema.fish, eq(schema.fish.id, schema.playerInventoryFish.fishId))
      .where(and(eq(schema.playerInventoryFish.playerId, playerId), eq(schema.fish.rarity, 'exotic'), eq(schema.playerInventoryFish.isLocked, false))),
    db.select().from(schema.playerBuffs).where(sql`${schema.playerBuffs.playerId} = ${playerId} AND ${schema.playerBuffs.endsAt} > now()`),
    db.select().from(schema.chests),
    loadOwnedLighthouseTitleIds(playerId),
    loadLighthouseState(),
  ]);
  const ownedMap = new Map(owned.map((item) => [item.artifactId, item]));
  const artifacts = defs.map((def) => {
    const level = ownedMap.get(def.id)?.level ?? 0;
    const labels = artifactLabels[def.id];
    return {
      id: def.id,
      name: extraArtifactNames[def.id] ?? def.name,
      effectPerLevel: labels?.effectPerLevel ?? artifactCurrentEffect(def, 1),
      maximumEffect: labels?.maximumEffect ?? artifactCurrentEffect(def, def.maxLevel),
      level,
      maximumLevel: def.maxLevel,
      currentEffect: artifactCurrentEffect(def, level),
    };
  });
  const remainingArtifactLevels = artifacts.reduce((sum, item) => sum + Math.max(0, item.maximumLevel - item.level), 0);
  let artifactPityDryDraws = 0;
  for (const draw of draws) {
    if (draw.rewardType === 'artifact' || draw.rewardType === 'artifact_upgrade') break;
    artifactPityDryDraws += 1;
  }
  const exoticFishAvailable = exoticRows.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);
  const totalDraws = Number(drawCountRow[0]?.count ?? draws.length);
  const serverTime = new Date().toISOString();
  const litUntil = lighthouseState.litUntil ?? new Date(Date.now() + 30 * 60_000).toISOString();
  return {
    serverTime,
    poolVersion: CURRENT_LOTTERY_POOL_VERSION,
    lighthouse: {
      isLit: Date.parse(litUntil) > Date.parse(serverTime),
      litUntil,
      totalContributedGold: lighthouseState.totalContributedGold,
      currentStepGold: lighthouseState.currentStepGold,
      stepTargetGold: LIGHTHOUSE_STEP_TARGET,
    },
    player: {
      gold: player.gold,
      relics: player.relics,
      exoticFishAvailable,
      artifactPityDryDraws,
      artifactPityRemaining: remainingArtifactLevels > 0 ? Math.max(0, ARTIFACT_PITY_LIMIT - artifactPityDryDraws) : null,
      remainingArtifactLevels,
      canUseExoticSingle: remainingArtifactLevels > 0 && exoticFishAvailable >= EXOTIC_FISH_PER_DRAW,
      canUseExoticTen: remainingArtifactLevels >= 10 && exoticFishAvailable >= EXOTIC_FISH_PER_DRAW * 10,
    },
    artifacts,
    buffs: activeBuffs.map((buff) => ({
      type: buff.buffType,
      name: buff.buffType === 'experience' ? '经验祝福' : buff.buffType === 'gold' ? '金币祝福' : '竞潮祝福',
      bonusBasisPoints: buff.bonusBasisPoints,
      endsAt: buff.endsAt.toISOString(),
      competitionSecondsRemaining: buff.buffType === 'competition' ? Math.max(0, Math.round((buff.endsAt.getTime() - buff.startsAt.getTime()) / 1000)) : null,
      isCountdownActive: buff.buffType === 'competition' ? false : true,
      countdownChangesAt: null,
    })),
    ownedLighthouseTitleIds: ownedTitleIds,
    recentDraws: draws.map((draw, index) => ({
      id: draw.id,
      drawIndex: Math.max(1, totalDraws - index),
      usedExoticFish: draw.costRelics === -1,
      createdAt: draw.createdAt.toISOString(),
      reward: rewardFromDraw(draw, defs, chestRows, new Set(ownedTitleIds)),
    })),
  };
}

export async function registerLighthouseRoutes(app: FastifyInstance) {
  app.get('/api/lighthouse-lottery', async (req, reply) => {
    const player = await requireAuth(req, reply);
    return currentLotteryState(player.id);
  });

  app.get('/api/lighthouse-lottery/status', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const state = await currentLotteryState(player.id);
    return { serverTime: state.serverTime, poolVersion: state.poolVersion, lighthouse: state.lighthouse };
  });

  app.post('/api/lighthouse-lottery/draws', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({ count: z.union([z.literal(1), z.literal(10)]), useExoticFish: z.boolean().optional().default(false) }).parse(req.body as any);
    const defs = (await db.select().from(schema.lighthouseArtifacts).where(eq(schema.lighthouseArtifacts.isActive, true)).orderBy(asc(schema.lighthouseArtifacts.orderIndex)))
      .map((def) => ({ ...def, name: extraArtifactNames[def.id] ?? def.name }));
    const ownedRows = await db.select().from(schema.playerArtifacts).where(eq(schema.playerArtifacts.playerId, player.id));
    const ownedMap = new Map(ownedRows.map((item) => [item.artifactId, item]));
    const remainingDefs = () => defs.filter((def) => (ownedMap.get(def.id)?.level ?? 0) < def.maxLevel);
    if (!remainingDefs().length) throw new AppError('ARTIFACTS_MAXED', '神器已全部满级，奇异鱼祈愿已关闭。');

    const count = body.count;
    const rewards: Array<{ reward: LotteryReward }> = [];
    let exoticFishSpent = 0;
    let consumedTitle: string | null = null;
    let nextLighthouseState: LighthouseState | null = null;
    const ownedTitles = new Set(await loadOwnedLighthouseTitleIds(player.id));

    if (body.useExoticFish) {
      if (remainingDefs().length < count) throw new AppError('INSUFFICIENT_ARTIFACT_LEVELS', '剩余神器等级不足，奇异鱼十连已停用。');
      const exoticRows = await db.select({
        fishId: schema.playerInventoryFish.fishId,
        quantity: schema.playerInventoryFish.quantity,
        sellPrice: schema.fish.sellPrice,
        isLocked: schema.playerInventoryFish.isLocked,
      }).from(schema.playerInventoryFish)
        .innerJoin(schema.fish, eq(schema.fish.id, schema.playerInventoryFish.fishId))
        .where(and(eq(schema.playerInventoryFish.playerId, player.id), eq(schema.fish.rarity, 'exotic'), eq(schema.playerInventoryFish.isLocked, false)))
        .orderBy(asc(schema.fish.sellPrice));
      const available = exoticRows.reduce((sum, row) => sum + Number(row.quantity), 0);
      if (available < count * EXOTIC_FISH_PER_DRAW) throw new AppError('INSUFFICIENT_EXOTIC_FISH', `可消耗奇异鱼不足 ${count * EXOTIC_FISH_PER_DRAW} 条。`);
      const toConsume = new Map<string, number>();
      let needed = count * EXOTIC_FISH_PER_DRAW;
      for (const row of exoticRows) {
        const amount = Math.min(needed, Number(row.quantity));
        if (amount > 0) toConsume.set(row.fishId, amount);
        needed -= amount;
        if (needed <= 0) break;
      }
      exoticFishSpent = count * EXOTIC_FISH_PER_DRAW;
      await db.transaction(async (tx) => {
        for (const [fishId, amount] of toConsume) {
          await tx.update(schema.playerInventoryFish)
            .set({ quantity: sql`${schema.playerInventoryFish.quantity} - ${amount}` })
            .where(and(eq(schema.playerInventoryFish.playerId, player.id), eq(schema.playerInventoryFish.fishId, fishId)));
        }
        for (let index = 0; index < count; index += 1) {
          const candidates = remainingDefs();
          const def = candidates[Math.floor(Math.random() * candidates.length)]!;
          const currentLevel = ownedMap.get(def.id)?.level ?? 0;
          const level = currentLevel + 1;
          if (ownedMap.has(def.id)) {
            await tx.update(schema.playerArtifacts).set({ level }).where(and(eq(schema.playerArtifacts.playerId, player.id), eq(schema.playerArtifacts.artifactId, def.id)));
          } else {
            await tx.insert(schema.playerArtifacts).values({ playerId: player.id, artifactId: def.id, level });
          }
          ownedMap.set(def.id, { playerId: player.id, artifactId: def.id, level, acquiredAt: new Date() } as any);
          rewards.push({ reward: { category: 'artifact', id: def.id, name: def.name, level } });
          await tx.insert(schema.lighthouseLotteryDraws).values({ playerId: player.id, costRelics: -1, rewardType: 'artifact', rewardId: def.id, rewardAmount: level });
        }
      });
    } else {
      const goldCost = count * LOTTERY_COST;
      if (player.gold < goldCost) throw new AppError('INSUFFICIENT_GOLD', '金币不足，无法为灯塔提供燃料。');
      const [chestRows, allDraws] = await Promise.all([
        db.select().from(schema.chests),
        db.select({ rewardType: schema.lighthouseLotteryDraws.rewardType }).from(schema.lighthouseLotteryDraws).where(eq(schema.lighthouseLotteryDraws.playerId, player.id)).orderBy(desc(schema.lighthouseLotteryDraws.createdAt)),
      ]);
      let pityDry = 0;
      for (const draw of allDraws) {
        if (draw.rewardType === 'artifact' || draw.rewardType === 'artifact_upgrade') break;
        pityDry += 1;
      }
      let fishAdded = 0;
      let goldAdded = 0;
      let relicsAdded = 0;
      const chestAdded = new Map<string, number>();
      const fishByRarity = new Map<string, number>();
      const buffsToAdd: typeof buffRewards = [];
      const artifactAdded = new Map<string, number>();
      await db.transaction(async (tx) => {
        await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${goldCost}` }).where(eq(schema.players.id, player.id));
        for (let index = 0; index < count; index += 1) {
          const availableCategories = lotteryCategories.filter((item) => {
            if (item.category === 'artifact') return remainingDefs().length > 0;
            if (item.category === 'title') return titleRewards.some((title) => !ownedTitles.has(title.titleId));
            return true;
          });
          const forceArtifact = remainingDefs().length > 0 && pityDry >= ARTIFACT_PITY_LIMIT - 1;
          const category = forceArtifact ? 'artifact' : (pickWeighted(availableCategories)?.category ?? 'gold');
          let reward: LotteryReward;
          if (category === 'gold') {
            const picked = pickWeighted(goldRewards)!;
            goldAdded += picked.quantity;
            reward = { category, name: '金币', quantity: picked.quantity };
          } else if (category === 'relic') {
            const picked = pickWeighted(relicRewards)!;
            relicsAdded += picked.quantity;
            reward = { category, name: '遗物', quantity: picked.quantity };
          } else if (category === 'fish') {
            const picked = pickWeighted(fishRewards)!;
            fishAdded += picked.quantity;
            fishByRarity.set(picked.rarity, (fishByRarity.get(picked.rarity) ?? 0) + picked.quantity);
            reward = { category, name: rarityNames[picked.rarity], quantity: picked.quantity, rarity: picked.rarity };
          } else if (category === 'chest') {
            const picked = pickWeighted(chestRewards)!;
            chestAdded.set(picked.chestId, (chestAdded.get(picked.chestId) ?? 0) + 1);
            reward = { category, name: picked.name, chestId: picked.chestId, quantity: 1 };
          } else if (category === 'buff') {
            const picked = pickWeighted(buffRewards)!;
            buffsToAdd.push(picked);
            reward = { category, name: picked.name, durationSeconds: picked.durationSeconds };
          } else if (category === 'title') {
            const availableTitles = titleRewards.filter((title) => !ownedTitles.has(title.titleId));
            const picked = pickWeighted(availableTitles)!;
            ownedTitles.add(picked.titleId);
            consumedTitle = picked.titleId;
            reward = { category, name: picked.name, titleId: picked.titleId };
          } else {
            const candidates = remainingDefs();
            const def = candidates[Math.floor(Math.random() * candidates.length)]!;
            const level = (ownedMap.get(def.id)?.level ?? 0) + 1;
            artifactAdded.set(def.id, level);
            reward = { category: 'artifact', id: def.id, name: def.name, level };
            pityDry = 0;
          }
          if (category !== 'artifact') pityDry += 1;
          rewards.push({ reward });
          await tx.insert(schema.lighthouseLotteryDraws).values({
            playerId: player.id,
            costRelics: 0,
            rewardType: reward.category,
            rewardId: reward.category === 'artifact' ? reward.id ?? null : reward.category === 'fish' ? reward.rarity ?? null : reward.category === 'chest' ? reward.chestId ?? null : reward.category === 'buff' ? (buffRewards.find((item) => item.name === reward.name)?.buffType ?? null) : reward.category === 'title' ? reward.titleId ?? null : null,
            rewardAmount: reward.category === 'artifact' ? reward.level ?? 1 : reward.category === 'buff' || reward.category === 'title' ? 1 : reward.quantity ?? 1,
          });
        }
        for (const [artifactId, level] of artifactAdded) {
          if (ownedMap.has(artifactId)) {
            await tx.update(schema.playerArtifacts).set({ level }).where(and(eq(schema.playerArtifacts.playerId, player.id), eq(schema.playerArtifacts.artifactId, artifactId)));
          } else {
            await tx.insert(schema.playerArtifacts).values({ playerId: player.id, artifactId, level });
          }
        }
        if (goldAdded) await tx.update(schema.players).set({ gold: sql`${schema.players.gold} + ${goldAdded}` }).where(eq(schema.players.id, player.id));
        if (relicsAdded) await tx.update(schema.players).set({ relics: sql`${schema.players.relics} + ${relicsAdded}` }).where(eq(schema.players.id, player.id));
        if (fishAdded) {
          for (const [rarity, quantity] of fishByRarity) {
            const targetFish = (await tx.select().from(schema.fish).where(eq(schema.fish.rarity, rarity)).limit(1))[0];
            if (!targetFish) continue;
            await tx.insert(schema.playerInventoryFish).values({ playerId: player.id, fishId: targetFish.id, quantity, totalCaught: quantity, firstCaughtAt: new Date(), lastCaughtAt: new Date() })
              .onConflictDoUpdate({ target: [schema.playerInventoryFish.playerId, schema.playerInventoryFish.fishId], set: { quantity: sql`${schema.playerInventoryFish.quantity} + ${quantity}`, totalCaught: sql`${schema.playerInventoryFish.totalCaught} + ${quantity}` } });
          }
        }
        for (const [chestId, quantity] of chestAdded) {
          await tx.insert(schema.playerChests).values({ playerId: player.id, chestId, quantity, openedCount: 0 })
            .onConflictDoUpdate({ target: [schema.playerChests.playerId, schema.playerChests.chestId], set: { quantity: sql`${schema.playerChests.quantity} + ${quantity}` } });
        }
        for (const buff of buffsToAdd) {
          await grantPlayerBuff(tx, {
            playerId: player.id,
            source: 'lighthouse',
            buffType: buff.buffType,
            bonusBasisPoints: buff.bonusBasisPoints,
            durationSeconds: buff.durationSeconds,
          });
        }
      });
      const lighthouseState = await loadLighthouseState();
      nextLighthouseState = advanceLighthouse(lighthouseState, goldCost);
      await saveLighthouseState(nextLighthouseState);
    }

    if (consumedTitle) await saveOwnedLighthouseTitleIds(player.id, [...ownedTitles]);
    return { state: await currentLotteryState(player.id), rewards, exoticFishSpent };
  });

  app.get('/api/player/reincarnation', async (req, reply) => {
    const player = await requireAuth(req, reply);
    return reincarnationState(player.id);
  });

  for (const kind of ['execute', 'allocate', 'reset'] as const) {
    app.post(`/api/player/reincarnation/${kind}`, async (req, reply) => {
      const player = await requireAuth(req, reply);
      if (kind === 'execute') {
        const state = await reincarnationState(player.id);
        if (!state.preview.eligible) throw new AppError('REINCARNATION_NOT_ELIGIBLE', '当前等级或金币不足，无法转生。');
        const reinc = (await db.select().from(schema.playerReincarnations).where(eq(schema.playerReincarnations.playerId, player.id)))[0];
        await ensureReincarnation(player.id);
        await db.transaction(async (tx) => {
          await tx.update(schema.players).set({
            level: 1, experience: 0, gold: 0, unspentStatPoints: 0,
            baseStrength: 0, baseIntelligence: 0, baseLuck: 0, baseEndurance: 100,
            currentBiomeId: 'b_001',
          }).where(eq(schema.players.id, player.id));
          await tx.update(schema.playerReincarnations).set({ round: (reinc?.round ?? 0) + 1, updatedAt: new Date() }).where(eq(schema.playerReincarnations.playerId, player.id));
        });
        const setting = await loadReincarnationSetting(player.id);
        setting.totalPoints += state.preview.awardedPoints;
        setting.revision += 1;
        await saveReincarnationSetting(player.id, setting);
        return reincarnationState(player.id);
      }
      const setting = await loadReincarnationSetting(player.id);
      if (kind === 'allocate') {
        const body = z.object({ configVersion: z.number().optional(), revision: z.number().optional(), ranks: z.record(z.number().int().min(0)) }).parse(req.body as any);
        const state = await reincarnationState(player.id);
        const ranks = validateReincarnationRanks(body.ranks);
        const requestedCost = reincarnationTalentCost(ranks);
        if (requestedCost > state.availablePoints) throw new AppError('INSUFFICIENT_REINCARNATION_POINTS', '天赋点不足。');
        setting.ranks = ranks;
        setting.spentPoints = requestedCost;
        setting.revision += 1;
        await saveReincarnationSetting(player.id, setting);
      } else {
        const body = z.object({ revision: z.number().optional() }).parse(req.body as any);
        void body;
        setting.spentPoints = 0;
        setting.ranks = { origin: 1 };
        setting.freeResets = Math.max(0, setting.freeResets - 1);
        setting.revision += 1;
        await saveReincarnationSetting(player.id, setting);
      }
      return reincarnationState(player.id);
    });
  }

  app.get('/api/lighthouse', async (req, reply) => {
    const player = await requireAuth(req, reply);
    await ensureReincarnation(player.id);
    const [defs, owned, draws, reincarnation] = await Promise.all([
      db.select().from(schema.lighthouseArtifacts).where(eq(schema.lighthouseArtifacts.isActive, true)).orderBy(asc(schema.lighthouseArtifacts.orderIndex)),
      db.select().from(schema.playerArtifacts).where(eq(schema.playerArtifacts.playerId, player.id)),
      db.select().from(schema.lighthouseLotteryDraws).where(eq(schema.lighthouseLotteryDraws.playerId, player.id)).orderBy(desc(schema.lighthouseLotteryDraws.createdAt)).limit(30),
      db.select().from(schema.playerReincarnations).where(eq(schema.playerReincarnations.playerId, player.id)),
    ]);
    const ownedMap = new Map(owned.map((a) => [a.artifactId, a]));
    const reinc = reincarnation[0] ?? { round: 0, strengthPoints: 0, intelligencePoints: 0, luckPoints: 0, endurancePoints: 0 };
    return {
      relics: player.relics,
      artifacts: defs.map((def) => {
        const item = ownedMap.get(def.id);
        const level = item?.level ?? 0;
        return {
          ...def,
          level,
          owned: !!item,
          currentBonus: def.baseBonus * level,
          nextCostRelics: item ? artifactUpgradeCost(def.upgradeRelicBase, def.upgradeRelicGrowth, level + 1) : null,
          maxed: !!item && level >= def.maxLevel,
        };
      }),
      lottery: { costRelics: LOTTERY_COST, draws },
      reincarnation: {
        round: reinc.round,
        points: {
          strength: reinc.strengthPoints,
          intelligence: reinc.intelligencePoints,
          luck: reinc.luckPoints,
          endurance: reinc.endurancePoints,
        },
        unlockLevel: 100,
        nextGain: Math.max(1, 1 + Math.floor(player.level / 50)),
      },
      serverTime: new Date().toISOString(),
    };
  });

  app.post('/api/lighthouse/artifacts/:artifactId/upgrade', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const artifactId = String((req.params as any).artifactId);
    const def = (await db.select().from(schema.lighthouseArtifacts).where(and(eq(schema.lighthouseArtifacts.id, artifactId), eq(schema.lighthouseArtifacts.isActive, true))))[0];
    if (!def) throw new AppError('ARTIFACT_NOT_FOUND', '神器不存在。');
    const item = (await db.select().from(schema.playerArtifacts).where(and(eq(schema.playerArtifacts.playerId, player.id), eq(schema.playerArtifacts.artifactId, artifactId))))[0];
    if (!item) throw new AppError('ARTIFACT_NOT_OWNED', '尚未获得这件神器，请先从灯塔祈愿中获取。');
    if (item.level >= def.maxLevel) throw new AppError('ARTIFACT_MAX_LEVEL', '神器已达到最高等级。');
    const cost = artifactUpgradeCost(def.upgradeRelicBase, def.upgradeRelicGrowth, item.level + 1);
    if (player.relics < cost) throw new AppError('INSUFFICIENT_RELICS', `遗物不足，需要 ${cost}。`);
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ relics: sql`${schema.players.relics} - ${cost}` }).where(eq(schema.players.id, player.id));
      await tx.update(schema.playerArtifacts).set({ level: item.level + 1 }).where(and(eq(schema.playerArtifacts.playerId, player.id), eq(schema.playerArtifacts.artifactId, artifactId)));
    });
    return { success: true, level: item.level + 1, costRelics: cost };
  });

  app.post('/api/lighthouse/lottery', async (req, reply) => {
    const player = await requireAuth(req, reply);
    if (player.relics < LOTTERY_COST) throw new AppError('INSUFFICIENT_RELICS', `灯塔祈愿需要 ${LOTTERY_COST} 遗物。`);
    const defs = await db.select().from(schema.lighthouseArtifacts).where(eq(schema.lighthouseArtifacts.isActive, true));
    const owned = await db.select().from(schema.playerArtifacts).where(eq(schema.playerArtifacts.playerId, player.id));
    const ownedMap = new Map(owned.map((a) => [a.artifactId, a]));
    const missing = defs.filter((d) => !ownedMap.has(d.id));
    const roll = Math.random();
    let reward: { type: string; id?: string; amount: number; label: string };

    if (missing.length && roll < 0.28) {
      const def = missing[Math.floor(Math.random() * missing.length)];
      reward = { type: 'artifact', id: def.id, amount: 1, label: def.name };
    } else if (roll < 0.62) {
      const amount = 30 + Math.floor(Math.random() * 80);
      reward = { type: 'relics', amount, label: `遗物 × ${amount}` };
    } else if (roll < 0.82) {
      const amount = 8 + Math.floor(Math.random() * 23);
      reward = { type: 'fragments', amount, label: `奥秘碎片 × ${amount}` };
    } else {
      const amount = Math.max(5000, player.level * 120 + Math.floor(Math.random() * player.level * 80));
      reward = { type: 'gold', amount, label: `金币 × ${amount.toLocaleString('zh-CN')}` };
    }

    const upgradedArtifact = reward.type === 'artifact'
      ? null
      : missing.length === 0 && roll < 0.28
        ? defs[Math.floor(Math.random() * defs.length)]
        : null;

    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({
        relics: sql`${schema.players.relics} - ${LOTTERY_COST} + ${reward.type === 'relics' ? reward.amount : 0}`,
        fragments: sql`${schema.players.fragments} + ${reward.type === 'fragments' ? reward.amount : 0}`,
        gold: sql`${schema.players.gold} + ${reward.type === 'gold' ? reward.amount : 0}`,
      }).where(eq(schema.players.id, player.id));

      if (reward.type === 'artifact' && reward.id) {
        await tx.insert(schema.playerArtifacts).values({ playerId: player.id, artifactId: reward.id, level: 1 });
      }
      if (upgradedArtifact) {
        const item = ownedMap.get(upgradedArtifact.id);
        if (item && item.level < upgradedArtifact.maxLevel) {
          await tx.update(schema.playerArtifacts).set({ level: item.level + 1 }).where(and(eq(schema.playerArtifacts.playerId, player.id), eq(schema.playerArtifacts.artifactId, upgradedArtifact.id)));
          reward = { type: 'artifact_upgrade', id: upgradedArtifact.id, amount: 1, label: `${upgradedArtifact.name} 强化` };
        }
      }
      await tx.insert(schema.lighthouseLotteryDraws).values({
        playerId: player.id,
        costRelics: LOTTERY_COST,
        rewardType: reward.type,
        rewardId: reward.id ?? null,
        rewardAmount: reward.amount,
      });
    });
    return { success: true, reward };
  });

  app.post('/api/player/reincarnation', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({ stat: z.enum(['strength', 'intelligence', 'luck', 'endurance']) }).parse(req.body as any);
    if (player.level < 100) throw new AppError('REINCARNATION_LEVEL', '达到 100 级后才能转生。');
    await ensureReincarnation(player.id);
    const rec = (await db.select().from(schema.playerReincarnations).where(eq(schema.playerReincarnations.playerId, player.id)))[0];
    const gain = Math.max(1, 1 + Math.floor(player.level / 50));
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({
        level: 1,
        experience: 0,
        gold: 10000,
        unspentStatPoints: 0,
        baseStrength: 0,
        baseIntelligence: 0,
        baseLuck: 0,
        baseEndurance: 100,
        currentBiomeId: 'b_001',
      }).where(eq(schema.players.id, player.id));
      const values = { round: rec.round + 1, updatedAt: new Date() } as Record<string, unknown>;
      const columnMap = {
        strength: schema.playerReincarnations.strengthPoints,
        intelligence: schema.playerReincarnations.intelligencePoints,
        luck: schema.playerReincarnations.luckPoints,
        endurance: schema.playerReincarnations.endurancePoints,
      } as const;
      const keyMap = {
        strength: 'strengthPoints', intelligence: 'intelligencePoints', luck: 'luckPoints', endurance: 'endurancePoints',
      } as const;
      values[keyMap[body.stat]] = sql`${columnMap[body.stat]} + ${gain}`;
      await tx.update(schema.playerReincarnations).set(values as any).where(eq(schema.playerReincarnations.playerId, player.id));
    });
    return { success: true, round: rec.round + 1, stat: body.stat, gainedPoints: gain };
  });
}

type ReincarnationSetting = { totalPoints: number; spentPoints: number; freeResets: number; ranks: Record<string, number>; revision: number };

async function loadReincarnationSetting(playerId: string): Promise<ReincarnationSetting> {
  const [row, reincarnation] = await Promise.all([
    db.select().from(schema.globalSettings).where(eq(schema.globalSettings.key, `reincarnation:${playerId}`)),
    db.select().from(schema.playerReincarnations).where(eq(schema.playerReincarnations.playerId, playerId)),
  ]);
  const value = row[0]?.value as Partial<ReincarnationSetting> | undefined;
  const completedRounds = reincarnation[0]?.round ?? 0;
  return {
    totalPoints: Number(value?.totalPoints ?? completedRounds * 20),
    spentPoints: Number(value?.spentPoints ?? 0),
    freeResets: Number(value?.freeResets ?? completedRounds),
    ranks: value?.ranks ?? { origin: 1 },
    revision: Number(value?.revision ?? 0),
  };
}

async function saveReincarnationSetting(playerId: string, value: ReincarnationSetting) {
  const key = `reincarnation:${playerId}`;
  await db.insert(schema.globalSettings).values({ key, value }).onConflictDoUpdate({ target: schema.globalSettings.key, set: { value, updatedAt: new Date() } });
}

async function reincarnationState(playerId: string) {
  await ensureReincarnation(playerId);
  const [player, reinc, setting, inventory, fishRows] = await Promise.all([
    db.select().from(schema.players).where(eq(schema.players.id, playerId)),
    db.select().from(schema.playerReincarnations).where(eq(schema.playerReincarnations.playerId, playerId)),
    loadReincarnationSetting(playerId),
    db.select().from(schema.playerInventoryFish).where(eq(schema.playerInventoryFish.playerId, playerId)),
    db.select().from(schema.fish),
  ]);
  const current = player[0];
  const arcaneIds = new Set(fishRows.filter((fish) => fish.rarity === 'arcane').map((fish) => fish.id));
  const arcaneFish = inventory.filter((row) => arcaneIds.has(row.fishId)).reduce((sum, row) => sum + Number(row.totalCaught), 0);
  const level = current.level;
  const fishPoints = Math.max(20, Math.min(40, arcaneFish));
  const levelPoints = reincarnationLevelPoints(level);
  const awardedPoints = fishPoints + levelPoints;
  const goldCost = 100_000_000 * ((reinc[0]?.round ?? 0) + 1);
  const spentPoints = reincarnationTalentCost(setting.ranks);
  const availablePoints = Math.max(0, setting.totalPoints - spentPoints);
  const preview = {
    requiredLevel: 15000,
    nextRequiredLevel: 15000,
    levelBefore: level,
    levelAfter: 1,
    experienceCleared: current.experience,
    effectiveLevel: level,
    fishPoints, levelPoints, awardedPoints, goldCost,
    goldAfter: current.gold - goldCost,
    refundedStatPoints: current.baseStrength + current.baseIntelligence + current.baseLuck + Math.max(0, current.baseEndurance - 100),
    lostStatPoints: current.baseStrength + current.baseIntelligence + current.baseLuck + Math.max(0, current.baseEndurance - 100),
    retainedStatPoints: 0,
    levelShortfall: Math.max(0, 15000 - level),
    goldShortfall: Math.max(0, goldCost - current.gold),
    eligible: level >= 15000 && current.gold >= goldCost,
  };
  const session = await buildSession(current);
  session.player.reincarnation = {
    round: reinc[0]?.round ?? 0,
    ranks: setting.ranks,
    equipmentRanks: {},
    equipmentPercentageBasisPoints: { strength: 0, intelligence: 0, luck: 0, endurance: 0 },
  } as any;
  return {
    round: reinc[0]?.round ?? 0,
    arcaneFish: fishPoints,
    lifetimeArcaneFish: arcaneFish,
    totalPoints: setting.totalPoints,
    spentPoints,
    availablePoints,
    freeResets: setting.freeResets,
    revision: setting.revision,
    configVersion: reincarnationConfigVersion(),
    ranks: setting.ranks,
    preview,
    previewKey: `preview-${setting.revision}-${level}-${current.gold}`,
    player: session.player,
    serverTime: new Date().toISOString(),
    history: [],
  };
}

async function ensureReincarnation(playerId: string) {
  const existing = (await db.select().from(schema.playerReincarnations).where(eq(schema.playerReincarnations.playerId, playerId)))[0];
  if (!existing) await db.insert(schema.playerReincarnations).values({ playerId });
}
