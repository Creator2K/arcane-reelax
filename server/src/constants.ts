export const RARITIES = [
  { id: 'common', name: '普通', colors: ['#9CA3AF'], order: 0 },
  { id: 'uncommon', name: '罕见', colors: ['#84CC16'], order: 1 },
  { id: 'fine', name: '精良', colors: ['#3B82F6'], order: 2 },
  { id: 'rare', name: '稀有', colors: ['#A855F7'], order: 3 },
  { id: 'epic', name: '史诗', colors: ['#EC4899'], order: 4 },
  { id: 'legendary', name: '传说', colors: ['#F59E0B'], order: 5 },
  { id: 'mythic', name: '神话', colors: ['#EF4444'], order: 6 },
  { id: 'exotic', name: '奇异', colors: ['#06B6D4', '#8B5CF6'], order: 7 },
  { id: 'arcane', name: '奥秘', colors: ['#A855F7', '#EC4899', '#F59E0B'], order: 8 },
] as const;

export const RARITY_ORDER = RARITIES.map((r) => r.id);

export const RARITY_XP_MULTIPLIERS: Record<string, number> = {
  common: 1.05, uncommon: 1.15, fine: 1.3, rare: 1.5, epic: 1.8,
  legendary: 2.2, mythic: 2.8, exotic: 3.6, arcane: 5.0,
};

export const BASE_XP_OPTIONS = [6.5, 6.6, 6.7, 6.8, 6.9, 7.0];

export const GEAR_SLOTS = ['head', 'chest', 'legs', 'boots', 'gloves', 'ring', 'amulet', 'charm'];
export const EQUIPPED_GEAR_SLOTS = ['head', 'chest', 'legs', 'boots', 'gloves', 'ring_1', 'ring_2', 'amulet', 'charm'];
export const RING_SLOTS = ['ring_1', 'ring_2'];

export const DAILY_CHECKIN_REWARDS = [
  { dayIndex: 1, gold: 100000, relics: 50, fragments: 0, chest: null },
  { dayIndex: 2, gold: 100000, relics: 0, fragments: 10, chest: null },
  { dayIndex: 3, gold: 0, relics: 0, fragments: 0, chest: { definitionId: 'magic_gear_chest', name: '魔法宝箱', quantity: 1 } },
  { dayIndex: 4, gold: 0, relics: 200, fragments: 0, chest: null },
  { dayIndex: 5, gold: 0, relics: 0, fragments: 0, chest: { definitionId: 'mysterious_gear_chest', name: '神话宝箱', quantity: 1 } },
  { dayIndex: 6, gold: 0, relics: 0, fragments: 25, chest: null },
  { dayIndex: 7, gold: 0, relics: 0, fragments: 0, chest: { definitionId: 'arcane_gear_chest', name: '奥术宝箱', quantity: 1 } },
];

export const MARKET_CONFIG = {
  maxActiveOrdersPerPlayer: 50,
  maxFishOrderQuantity: 100000,
  orderDurationSeconds: 604800,
  sellerFeeBasisPoints: 500,
  version: 1,
};

export const ARCANE_CHEST_HARD_PITY = 1500;

export const LEVEL_EXP_FORMULA = (level: number) => Math.floor(100 + 29.0908424 * Math.pow(level, 1.5614014));

export const STAT_COST_PER_POINT = 10000; // gold per stat point
export const STAT_RESET_COST = 10000;

export const MASTERY_XP_PER_LEVEL = 1000;

export const QUEST_REROLL_COST = 100000;

export const WEATHER_CYCLE_MS = 2 * 60 * 60 * 1000; // 2h
export const OFFLINE_SWITCH_DELAY_MS = 60 * 1000; // 1 min
export const OFFLINE_GRACE_MS = 60 * 1000;

export const FISH_PRICE_SELL_NPC_RATIO = 1; // sellPrice is what NPC pays per fish

export const GUILD_CONFIG = {
  creationCost: 100000,
  baseMemberCapacity: 15,
  publicDescriptionMaxLength: 120,
  announcementMaxLength: 120,
  taxRateMaxPercent: 50,
  identityChangeCost: 5000000,
  nameStyleSolidCost: 5000000,
  nameStyleGradientBaseCost: 10000000,
  nameStyleGradientAdditionalColorCost: 3000000,
  boostDurationMinutes: 30,
  boostUnitCost: 500000,
  boostMaxUnits: 48,
  boostMaxDurationHours: 24,
};

export const GUILD_TOTEM_TYPES = ['experience', 'gold', 'luck', 'relic'];

export const EXCHANGE_LIMITS = {
  goldToRelicDailyMax: 10000,
  goldToRelicInitialPrice: 7467,
  goldToRelicStep: 25, // per unit price increase
  goldToFragmentDailyMax: 1000,
  goldToFragmentInitialPrice: 70150,
  goldToFragmentStep: 150,
};

export const TOURNAMENT_GROUP_CONFIG = {
  rookie: { name: '新星组', maxLevel: 49 },
  wave: { name: '逐浪组', minLevel: 50, maxLevel: 499 },
  tide: { name: '听潮组', minLevel: 500 },
};

export const ACHIEVEMENT_CATEGORIES = [
  { id: 'fishing', label: '垂钓' },
  { id: 'biomes', label: '地图' },
  { id: 'weather', label: '天气' },
  { id: 'bait', label: '鱼饵' },
  { id: 'collection', label: '收藏' },
  { id: 'progression', label: '成长' },
  { id: 'commerce', label: '交易' },
  { id: 'competition', label: '赛事' },
  { id: 'dedication', label: '旅程' },
];

export const ACHIEVEMENT_VERSION = 1;
export const USER_AGREEMENT_VERSION = '2026-08-13';

export const BUFF_CATEGORIES = ['experience', 'gold', 'strength', 'intelligence', 'luck', 'endurance'] as const;
