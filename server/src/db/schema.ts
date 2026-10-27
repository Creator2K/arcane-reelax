import { pgTable, uuid, varchar, integer, bigint, boolean, timestamp, text, jsonb, real, primaryKey, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 254 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  acceptedUserAgreementVersion: varchar('accepted_user_agreement_version', { length: 20 }).notNull().default('2026-08-13'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
});

export const players = pgTable('players', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().unique().references(() => accounts.id, { onDelete: 'cascade' }),
  publicId: integer('public_id').notNull().unique(),
  nickname: varchar('nickname', { length: 24 }).notNull(),
  level: integer('level').notNull().default(1),
  experience: bigint('experience', { mode: 'number' }).notNull().default(0),
  gold: bigint('gold', { mode: 'number' }).notNull().default(0),
  relics: bigint('relics', { mode: 'number' }).notNull().default(0),
  fragments: bigint('fragments', { mode: 'number' }).notNull().default(0),
  unspentStatPoints: integer('unspent_stat_points').notNull().default(0),
  freeRodResetCredits: integer('free_rod_reset_credits').notNull().default(1),
  currentBiomeId: varchar('current_biome_id', { length: 16 }).notNull().default('b_001'),
  equippedRodId: varchar('equipped_rod_id', { length: 64 }).notNull().default('novice_rod'),
  selectedBaitId: varchar('selected_bait_id', { length: 32 }).notNull().default('bait_basic'),
  equippedTitleId: varchar('equipped_title_id', { length: 64 }),
  avatarId: varchar('avatar_id', { length: 64 }).notNull().default('moonfall-scout'),
  nameStyleMode: varchar('name_style_mode', { length: 16 }).notNull().default('default'),
  nameStyleColors: jsonb('name_style_colors').$type<string[]>().default([]),
  nameStyleAngle: integer('name_style_angle'),
  equippedFishShowcaseId: varchar('equipped_fish_showcase_id', { length: 64 }),
  showcaseFishIds: jsonb('showcase_fish_ids').$type<string[]>().default([]),
  achievementShowcaseIds: jsonb('achievement_showcase_ids').$type<string[]>().default([]),
  baseStrength: integer('base_strength').notNull().default(0),
  baseIntelligence: integer('base_intelligence').notNull().default(0),
  baseLuck: integer('base_luck').notNull().default(0),
  baseEndurance: integer('base_endurance').notNull().default(100),
  goldPenaltyTotal: bigint('gold_penalty_total', { mode: 'number' }).notNull().default(0),
  acknowledgedGoldPenaltyTotal: bigint('acknowledged_gold_penalty_total', { mode: 'number' }).notNull().default(0),
  marketAccessStatus: varchar('market_access_status', { length: 16 }).notNull().default('enabled'),
  totalCasts: bigint('total_casts', { mode: 'number' }).notNull().default(0),
  totalFishCaught: bigint('total_fish_caught', { mode: 'number' }).notNull().default(0),
  totalChestsOpened: bigint('total_chests_opened', { mode: 'number' }).notNull().default(0),
  totalGearUpgrades: bigint('total_gear_upgrades', { mode: 'number' }).notNull().default(0),
  totalRelicDrops: integer('total_relic_drops').notNull().default(0),
  totalRelicQuantity: bigint('total_relic_quantity', { mode: 'number' }).notNull().default(0),
  totalChestsDropped: bigint('total_chests_dropped', { mode: 'number' }).notNull().default(0),
  totalGearDropped: bigint('total_gear_dropped', { mode: 'number' }).notNull().default(0),
  npcFishSoldQuantity: bigint('npc_fish_sold_quantity', { mode: 'number' }).notNull().default(0),
  npcFishSoldGold: bigint('npc_fish_sold_gold', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const contentMeta = pgTable('content_meta', {
  id: varchar('id', { length: 32 }).primaryKey(),
  contentVersion: varchar('content_version', { length: 16 }).notNull(),
  statResetCostGold: bigint('stat_reset_cost_gold', { mode: 'number' }).notNull().default(10000),
});

export const biomes = pgTable('biomes', {
  id: varchar('id', { length: 16 }).primaryKey(),
  name: varchar('name', { length: 32 }).notNull(),
  theme: text('theme').notNull(),
  requiredLevel: integer('required_level').notNull().default(0),
  requiredReincarnationRound: integer('required_reincarnation_round').notNull().default(0),
  unlockCost: bigint('unlock_cost', { mode: 'number' }).notNull().default(0),
  valueMultiplier: real('value_multiplier').notNull().default(1),
  directGoldMin: integer('direct_gold_min').notNull().default(50),
  directGoldMax: integer('direct_gold_max').notNull().default(100),
  orderIndex: integer('order_index').notNull().default(0),
});

export const fish = pgTable('fish', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  description: text('description').notNull().default(''),
  biomeId: varchar('biome_id', { length: 16 }).notNull().references(() => biomes.id),
  rarity: varchar('rarity', { length: 16 }).notNull(),
  sellPrice: integer('sell_price').notNull().default(0),
  imagePath: varchar('image_path', { length: 255 }).notNull().default(''),
});

export const rods = pgTable('rods', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  description: varchar('description', { length: 255 }).notNull(),
  requiredLevel: integer('required_level').notNull(),
  purchaseCost: bigint('purchase_cost', { mode: 'number' }).notNull(),
  baseUpgradeCost: bigint('base_upgrade_cost', { mode: 'number' }).notNull().default(0),
  upgradeCostGrowth: real('upgrade_cost_growth').notNull().default(1),
  maxLevel: integer('max_level').notNull(),
  statPerLevel: jsonb('stat_per_level').$type<Record<string, number>>().notNull().default({}),
  specialEffect: jsonb('special_effect').$type<{ kind: string; value: number } | null>().default(null),
  orderIndex: integer('order_index').notNull().default(0),
});

export const baits = pgTable('baits', {
  id: varchar('id', { length: 32 }).primaryKey(),
  tier: varchar('tier', { length: 16 }).notNull(),
  name: varchar('name', { length: 32 }).notNull(),
  unitPrice: integer('unit_price').notNull().default(0),
  luck: integer('luck').notNull().default(0),
  minRarityIndex: integer('min_rarity_index').notNull().default(0),
  maxRarityIndex: integer('max_rarity_index').notNull().default(1),
  fishRarityMultipliers: jsonb('fish_rarity_multipliers').$type<Record<string, number>>().default({}),
  allowsRelic: boolean('allows_relic').notNull().default(false),
  allowsGear: boolean('allows_gear').notNull().default(false),
  allowsChest: boolean('allows_chest').notNull().default(false),
  isUnlimited: boolean('is_unlimited').notNull().default(false),
  orderIndex: integer('order_index').notNull().default(0),
});

export const weather = pgTable('weather', {
  id: varchar('id', { length: 32 }).primaryKey(),
  name: varchar('name', { length: 32 }).notNull(),
  effect: varchar('effect', { length: 128 }).notNull(),
  refreshWeight: integer('refresh_weight').notNull().default(1),
  xpMultiplier: real('xp_multiplier').notNull().default(1),
  quantityBonus: integer('quantity_bonus').notNull().default(0),
  gearCategoryMultiplier: real('gear_category_multiplier').notNull().default(1),
  relicCategoryMultiplier: real('relic_category_multiplier').notNull().default(1),
  rarityMultipliers: jsonb('rarity_multipliers').$type<Record<string, number>>().default({}),
  directGoldRangeBonus: jsonb('direct_gold_range_bonus').$type<[number, number] | null>().default(null),
  excludedBiomeIds: jsonb('excluded_biome_ids').$type<string[]>().default([]),
  rarityDisplayPercentages: jsonb('rarity_display_percentages').$type<Record<string, number>>().default({}),
  orderIndex: integer('order_index').notNull().default(0),
});

export const gearTemplates = pgTable('gear_templates', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  slot: varchar('slot', { length: 16 }).notNull(),
  minQuality: integer('min_quality').notNull().default(0),
  maxQuality: integer('max_quality').notNull().default(100),
  baseStatRange: jsonb('base_stat_range').$type<Record<string, [number, number]>>().notNull().default({}),
  sourceBiomeId: varchar('source_biome_id', { length: 16 }),
  minRarityIndex: integer('min_rarity_index').notNull().default(0),
  maxRarityIndex: integer('max_rarity_index').notNull().default(6),
  upgradeGoldBase: bigint('upgrade_gold_base', { mode: 'number' }).notNull().default(1000),
  upgradeGoldGrowth: real('upgrade_gold_growth').notNull().default(1.6),
  upgradeRelicBase: integer('upgrade_relic_base').notNull().default(10),
  upgradeRelicGrowth: real('upgrade_relic_growth').notNull().default(1.4),
  salvageRelicMin: integer('salvage_relic_min').notNull().default(0),
  salvageRelicMax: integer('salvage_relic_max').notNull().default(0),
  canReroll: boolean('can_reroll').notNull().default(true),
});

export const gearItems = pgTable('gear_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  templateId: varchar('template_id', { length: 64 }).notNull().references(() => gearTemplates.id),
  name: varchar('name', { length: 64 }).notNull(),
  slot: varchar('slot', { length: 16 }).notNull(),
  rarity: varchar('rarity', { length: 16 }).notNull(),
  quality: integer('quality').notNull().default(0),
  qualityStars: integer('quality_stars').notNull().default(0),
  baseStats: jsonb('base_stats').$type<Record<string, number>>().notNull().default({}),
  upgradeLevel: integer('upgrade_level').notNull().default(0),
  limitBreakPercent: integer('limit_break_percent').notNull().default(0),
  isEquipped: boolean('is_equipped').notNull().default(false),
  equippedSlot: varchar('equipped_slot', { length: 16 }),
  isMarketListed: boolean('is_market_listed').notNull().default(false),
  isLocked: boolean('is_locked').notNull().default(false),
  sourceBiomeId: varchar('source_biome_id', { length: 16 }),
  contentVersion: varchar('content_version', { length: 16 }).notNull().default('2026.22'),
  generationVersion: varchar('generation_version', { length: 16 }).notNull().default('gear-v2'),
  acquiredAt: timestamp('acquired_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const chests = pgTable('chests', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 32 }).notNull(),
  price: bigint('price', { mode: 'number' }).notNull(),
  paymentOptions: jsonb('payment_options').$type<Array<{ currency: string; unitPrice: number; dailyLimit: number | null }>>().notNull(),
  rarityChances: jsonb('rarity_chances').$type<Array<{ rarity: string; chancePermille: number }>>().notNull(),
  orderIndex: integer('order_index').notNull().default(0),
});

export const playerChests = pgTable('player_chests', {
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  chestId: varchar('chest_id', { length: 64 }).notNull().references(() => chests.id),
  quantity: integer('quantity').notNull().default(0),
  openedCount: bigint('opened_count', { mode: 'number' }).notNull().default(0),
  arcaneChestsSinceArcaneGear: integer('arcane_chests_since_arcane_gear').notNull().default(0),
  purchasedToday: integer('purchased_today').notNull().default(0),
  lastPurchaseDate: varchar('last_purchase_date', { length: 10 }),
}, (t) => [primaryKey({ columns: [t.playerId, t.chestId] })]);

export const playerBiomes = pgTable('player_biomes', {
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  biomeId: varchar('biome_id', { length: 16 }).notNull().references(() => biomes.id),
  isUnlocked: boolean('is_unlocked').notNull().default(false),
  unlockedAt: timestamp('unlocked_at'),
  masteryXp: bigint('mastery_xp', { mode: 'number' }).notNull().default(0),
  masteryLevel: integer('mastery_level').notNull().default(0),
  xpBonusBasisPoints: integer('xp_bonus_basis_points').notNull().default(0),
  directGoldBonusBasisPoints: integer('direct_gold_basis_points').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.playerId, t.biomeId] })]);

export const playerRods = pgTable('player_rods', {
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  rodId: varchar('rod_id', { length: 64 }).notNull().references(() => rods.id),
  level: integer('level').notNull().default(1),
  isOwned: boolean('is_owned').notNull().default(false),
  investedGold: bigint('invested_gold', { mode: 'number' }).notNull().default(0),
  upgradeCount: integer('upgrade_count').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.playerId, t.rodId] })]);

export const playerBaits = pgTable('player_baits', {
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  baitId: varchar('bait_id', { length: 32 }).notNull().references(() => baits.id),
  quantity: integer('quantity').notNull().default(0),
  autoRefill: boolean('auto_refill').notNull().default(false),
  autoRefillQuantity: integer('auto_refill_quantity').notNull().default(100),
}, (t) => [primaryKey({ columns: [t.playerId, t.baitId] })]);

export const playerInventoryFish = pgTable('player_inventory_fish', {
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  fishId: varchar('fish_id', { length: 64 }).notNull().references(() => fish.id),
  quantity: bigint('quantity', { mode: 'number' }).notNull().default(0),
  totalCaught: bigint('total_caught', { mode: 'number' }).notNull().default(0),
  firstCaughtAt: timestamp('first_caught_at'),
  lastCaughtAt: timestamp('last_caught_at'),
  isLocked: boolean('is_locked').notNull().default(false),
}, (t) => [primaryKey({ columns: [t.playerId, t.fishId] })]);

export const masteryTargets = pgTable('mastery_targets', {
  id: varchar('id', { length: 64 }).primaryKey(),
  biomeId: varchar('biome_id', { length: 16 }).notNull().references(() => biomes.id),
  rarity: varchar('rarity', { length: 16 }).notNull(),
  fishId: varchar('fish_id', { length: 64 }).notNull().references(() => fish.id),
  levelIndex: integer('level_index').notNull().default(0),
  requiredQuantity: bigint('required_quantity', { mode: 'number' }).notNull(),
  xpBonusBasisPointsPerLevel: integer('xp_bonus_basis_points').notNull().default(250),
  directGoldBonusBasisPointsPerLevel: integer('direct_gold_bonus_basis_points').notNull().default(250),
  maxLevel: integer('max_level').notNull().default(5),
});

export const playerMasteryProgress = pgTable('player_mastery_progress', {
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  targetId: varchar('target_id', { length: 64 }).notNull().references(() => masteryTargets.id),
  completedLevel: integer('completed_level').notNull().default(0),
  contributedQuantity: bigint('contributed_quantity', { mode: 'number' }).notNull().default(0),
}, (t) => [primaryKey({ columns: [t.playerId, t.targetId] })]);

export const talents = pgTable('talents', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  description: varchar('description', { length: 255 }).notNull(),
  effectKind: varchar('effect_kind', { length: 64 }).notNull(),
  effectPerRank: jsonb('effect_per_rank').$type<number | Record<string, number>>().notNull(),
  maxRank: integer('max_rank').notNull().default(10),
  prerequisiteTalentId: varchar('prerequisite_talent_id', { length: 64 }),
  prerequisiteRank: integer('prerequisite_rank'),
  orderIndex: integer('order_index').notNull().default(0),
});

export const playerTalents = pgTable('player_talents', {
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  talentId: varchar('talent_id', { length: 64 }).notNull().references(() => talents.id),
  rank: integer('rank').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.playerId, t.talentId] })]);

export const questTemplates = pgTable('quest_templates', {
  id: varchar('id', { length: 64 }).primaryKey(),
  period: varchar('period', { length: 16 }).notNull(),
  slot: integer('slot').notNull(),
  category: varchar('category', { length: 32 }).notNull(),
  objectiveType: varchar('objective_type', { length: 64 }).notNull(),
  descriptionTemplate: varchar('description_template', { length: 255 }).notNull(),
  target: bigint('target', { mode: 'number' }).notNull(),
  rewardRelics: integer('reward_relics').notNull().default(0),
  rewardGold: bigint('reward_gold', { mode: 'number' }).notNull().default(0),
  weight: integer('weight').notNull().default(10),
  biomeId: varchar('biome_id', { length: 16 }),
  weatherId: varchar('weather_id', { length: 32 }),
  baitTier: varchar('bait_tier', { length: 16 }),
  rarity: varchar('rarity', { length: 16 }),
  settlementMode: varchar('settlement_mode', { length: 16 }),
  fishId: varchar('fish_id', { length: 64 }),
}, (t) => [uniqueIndex('quest_tpl_period_slot').on(t.period, t.slot)]);

export const playerQuests = pgTable('player_quests', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  period: varchar('period', { length: 16 }).notNull(),
  periodKey: varchar('period_key', { length: 24 }).notNull(),
  slot: integer('slot').notNull(),
  templateId: varchar('template_id', { length: 64 }),
  category: varchar('category', { length: 32 }).notNull(),
  objectiveType: varchar('objective_type', { length: 64 }).notNull(),
  description: varchar('description', { length: 255 }).notNull(),
  target: bigint('target', { mode: 'number' }).notNull(),
  progress: bigint('progress', { mode: 'number' }).notNull().default(0),
  rewardRelics: integer('reward_relics').notNull().default(0),
  rewardGold: bigint('reward_gold', { mode: 'number' }).notNull().default(0),
  status: varchar('status', { length: 16 }).notNull().default('in_progress'),
  biomeId: varchar('biome_id', { length: 16 }),
  biomeName: varchar('biome_name', { length: 32 }),
  isBiomeUnlocked: boolean('is_biome_unlocked'),
  weatherId: varchar('weather_id', { length: 32 }),
  weatherName: varchar('weather_name', { length: 32 }),
  baitId: varchar('bait_id', { length: 32 }),
  baitName: varchar('bait_name', { length: 32 }),
  rarity: varchar('rarity', { length: 16 }),
  rarityName: varchar('rarity_name', { length: 16 }),
  settlementMode: varchar('settlement_mode', { length: 16 }),
  completedAt: timestamp('completed_at'),
  claimedAt: timestamp('claimed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('player_quest_period_slot').on(t.playerId, t.period, t.periodKey, t.slot)]);

export const achievementDefinitions = pgTable('achievement_definitions', {
  id: varchar('id', { length: 64 }).primaryKey(),
  category: varchar('category', { length: 32 }).notNull(),
  name: varchar('name', { length: 64 }).notNull(),
  description: varchar('description', { length: 255 }).notNull(),
  threshold: bigint('threshold', { mode: 'number' }).notNull(),
  rewardRelics: integer('reward_relics').notNull().default(0),
  titleId: varchar('title_id', { length: 64 }),
  seriesId: varchar('series_id', { length: 64 }),
  seriesName: varchar('series_name', { length: 64 }),
  seriesStep: integer('series_step'),
  seriesTotalSteps: integer('series_total_steps'),
  version: integer('version').notNull().default(1),
  orderIndex: integer('order_index').notNull().default(0),
});

export const titles = pgTable('titles', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  description: varchar('description', { length: 255 }).notNull(),
  imagePath: varchar('image_path', { length: 255 }).notNull().default(''),
  textColor: varchar('text_color', { length: 16 }),
  backgroundColor: varchar('background_color', { length: 16 }),
  borderColor: varchar('border_color', { length: 16 }),
  borderEffect: varchar('border_effect', { length: 16 }),
  isInternal: boolean('is_internal').notNull().default(false),
  orderIndex: integer('order_index').notNull().default(0),
});

export const playerAchievements = pgTable('player_achievements', {
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  achievementId: varchar('achievement_id', { length: 64 }).notNull().references(() => achievementDefinitions.id),
  progress: bigint('progress', { mode: 'number' }).notNull().default(0),
  status: varchar('status', { length: 16 }).notNull().default('in_progress'),
  claimedAt: timestamp('claimed_at'),
}, (t) => [primaryKey({ columns: [t.playerId, t.achievementId] })]);

export const avatars = pgTable('avatars', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  imagePath: varchar('image_path', { length: 255 }).notNull().default(''),
  source: varchar('source', { length: 16 }).notNull().default('base'),
  priceGold: bigint('price_gold', { mode: 'number' }),
  priceRelics: bigint('price_relics', { mode: 'number' }),
  priceFragments: bigint('price_fragments', { mode: 'number' }),
  isActive: boolean('is_active').notNull().default(true),
  orderIndex: integer('order_index').notNull().default(0),
});

export const playerAvatars = pgTable('player_avatars', {
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  avatarId: varchar('avatar_id', { length: 64 }).notNull().references(() => avatars.id),
  unlockedAt: timestamp('unlocked_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.playerId, t.avatarId] })]);

export const fishingRuns = pgTable('fishing_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 16 }).notNull().default('running'),
  mode: varchar('mode', { length: 16 }).notNull().default('online'),
  biomeId: varchar('biome_id', { length: 16 }).notNull(),
  totalCasts: integer('total_casts').notNull(),
  remainingCasts: integer('remaining_casts').notNull(),
  cycleDurationMs: integer('cycle_duration_ms').notNull().default(6000),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  nextCastAt: timestamp('next_cast_at'),
  lastSyncAt: timestamp('last_sync_at').notNull().defaultNow(),
  offlineSince: timestamp('offline_since'),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  snapshotKey: varchar('snapshot_key', { length: 64 }).notNull().default(''),
  results: jsonb('results').$type<Array<Record<string, unknown>>>().notNull().default([]),
  batchGold: bigint('batch_gold', { mode: 'number' }).notNull().default(0),
  batchExperience: bigint('batch_experience', { mode: 'number' }).notNull().default(0),
  batchFishQuantity: bigint('batch_fish_quantity', { mode: 'number' }).notNull().default(0),
  batchRelics: integer('batch_relics').notNull().default(0),
  batchChests: integer('batch_chests').notNull().default(0),
  batchGearCount: integer('batch_gear_count').notNull().default(0),
  guildTaxGold: bigint('guild_tax_gold', { mode: 'number' }).notNull().default(0),
  partyBonusExperience: bigint('party_bonus_experience', { mode: 'number' }).notNull().default(0),
  endedAt: timestamp('ended_at'),
  endReason: varchar('end_reason', { length: 32 }),
}, (t) => [index('fishing_runs_player_idx').on(t.playerId)]);

export const dailyHarvest = pgTable('daily_harvest', {
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  date: varchar('date', { length: 10 }).notNull(),
  casts: integer('casts').notNull().default(0),
  fishByRarity: jsonb('fish_by_rarity').$type<Record<string, number>>().notNull().default({}),
  gear: integer('gear').notNull().default(0),
  chests: integer('chests').notNull().default(0),
  relics: integer('relics').notNull().default(0),
  goldIncome: bigint('gold_income', { mode: 'number' }).notNull().default(0),
  baitCost: bigint('bait_cost', { mode: 'number' }).notNull().default(0),
  netGold: bigint('net_gold', { mode: 'number' }).notNull().default(0),
}, (t) => [primaryKey({ columns: [t.playerId, t.date] })]);

export const dailyCheckIns = pgTable('daily_check_ins', {
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  date: varchar('date', { length: 10 }).notNull(),
  cycleIndex: integer('cycle_index').notNull().default(1),
  rewardDay: integer('reward_day').notNull().default(1),
  claimedAt: timestamp('claimed_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.playerId, t.date] })]);

export const marketOrders = pgTable('market_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => players.id),
  assetType: varchar('asset_type', { length: 16 }).notNull(),
  side: varchar('side', { length: 8 }).notNull(),
  status: varchar('status', { length: 16 }).notNull().default('active'),
  limitUnitPrice: bigint('limit_unit_price', { mode: 'number' }).notNull(),
  initialQuantity: bigint('initial_quantity', { mode: 'number' }).notNull(),
  remainingQuantity: bigint('remaining_quantity', { mode: 'number' }).notNull(),
  grossFilled: bigint('gross_filled', { mode: 'number' }).notNull().default(0),
  feeCharged: bigint('fee_charged', { mode: 'number' }).notNull().default(0),
  feeBasisPoints: integer('fee_basis_points').notNull().default(500),
  fishId: varchar('fish_id', { length: 64 }),
  gearId: uuid('gear_id'),
  itemType: varchar('item_type', { length: 32 }),
  escrowGold: bigint('escrow_gold', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  filledAt: timestamp('filled_at'),
  cancelledAt: timestamp('cancelled_at'),
}, (t) => [index('market_orders_asset_idx').on(t.assetType, t.status), index('market_orders_fish_idx').on(t.fishId)]);

export const marketTrades = pgTable('market_trades', {
  id: uuid('id').primaryKey().defaultRandom(),
  assetType: varchar('asset_type', { length: 16 }).notNull(),
  fishId: varchar('fish_id', { length: 64 }),
  unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
  quantity: bigint('quantity', { mode: 'number' }).notNull(),
  sellerId: uuid('seller_id').notNull().references(() => players.id),
  buyerId: uuid('buyer_id').notNull().references(() => players.id),
  sellerOrderId: uuid('seller_order_id'),
  buyerOrderId: uuid('buyer_order_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('market_trades_asset_idx').on(t.assetType, t.fishId)]);

export const barterOffers = pgTable('barter_offers', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => players.id),
  status: varchar('status', { length: 16 }).notNull().default('active'),
  giveFishId: varchar('give_fish_id', { length: 64 }).notNull(),
  wantFishId: varchar('want_fish_id', { length: 64 }).notNull(),
  quantity: integer('quantity').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  acceptedAt: timestamp('accepted_at'),
  cancelledAt: timestamp('cancelled_at'),
});

export const barterTrades = pgTable('barter_trades', {
  id: uuid('id').primaryKey().defaultRandom(),
  offerId: uuid('offer_id').notNull().references(() => barterOffers.id),
  giverId: uuid('giver_id').notNull().references(() => players.id),
  receiverId: uuid('receiver_id').notNull().references(() => players.id),
  giveFishId: varchar('give_fish_id', { length: 64 }).notNull(),
  wantFishId: varchar('want_fish_id', { length: 64 }).notNull(),
  quantity: integer('quantity').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const conveniencePurchases = pgTable('convenience_purchases', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').notNull().references(() => players.id),
  productId: varchar('product_id', { length: 64 }).notNull(),
  durationSeconds: integer('duration_seconds').notNull(),
  priceGold: bigint('price_gold', { mode: 'number' }).notNull(),
  startsAt: timestamp('starts_at').notNull().defaultNow(),
  endsAt: timestamp('ends_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const shopBuffs = pgTable('shop_buffs', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  description: varchar('description', { length: 128 }).notNull(),
  shop: varchar('shop', { length: 16 }).notNull(),
  currency: varchar('currency', { length: 16 }).notNull(),
  productType: varchar('product_type', { length: 16 }).notNull(),
  price: bigint('price', { mode: 'number' }).notNull(),
  buffCategory: varchar('buff_category', { length: 16 }).notNull(),
  bonusBasisPoints: integer('bonus_basis_points').notNull(),
  durationSeconds: integer('duration_seconds').notNull(),
  isGlobal: boolean('is_global').notNull().default(false),
  orderIndex: integer('order_index').notNull().default(0),
});

export const playerBuffs = pgTable('player_buffs', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').notNull().references(() => players.id),
  source: varchar('source', { length: 32 }).notNull().default('player_shop'),
  buffType: varchar('buff_type', { length: 16 }).notNull(),
  bonusBasisPoints: integer('bonus_basis_points').notNull(),
  startsAt: timestamp('starts_at').notNull().defaultNow(),
  endsAt: timestamp('ends_at').notNull(),
});

export const globalBuffs = pgTable('global_buffs', {
  id: uuid('id').primaryKey().defaultRandom(),
  buffType: varchar('buff_type', { length: 16 }).notNull(),
  bonusBasisPoints: integer('bonus_basis_points').notNull(),
  purchaserId: uuid('purchaser_id').references(() => players.id),
  startsAt: timestamp('starts_at').notNull().defaultNow(),
  endsAt: timestamp('ends_at').notNull(),
});

export const guilds = pgTable('guilds', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 24 }).notNull().unique(),
  tag: varchar('tag', { length: 8 }).notNull().unique(),
  publicDescription: varchar('public_description', { length: 120 }).notNull().default('暂无公开介绍'),
  announcement: varchar('announcement', { length: 120 }).notNull().default(''),
  level: integer('level').notNull().default(1),
  experience: bigint('experience', { mode: 'number' }).notNull().default(0),
  taxRatePercent: integer('tax_rate_percent').notNull().default(0),
  recruitmentMode: varchar('recruitment_mode', { length: 16 }).notNull().default('open'),
  minimumApplicationLevel: integer('minimum_application_level').notNull().default(0),
  treasuryGold: bigint('treasury_gold', { mode: 'number' }).notNull().default(0),
  leaderId: uuid('leader_id').notNull().references(() => players.id),
  nameStyleMode: varchar('name_style_mode', { length: 16 }).notNull().default('default'),
  nameStyleColors: jsonb('name_style_colors').$type<string[]>().default([]),
  nameStyleAngle: integer('name_style_angle').notNull().default(35),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const guildMembers = pgTable('guild_members', {
  guildId: uuid('guild_id').notNull().references(() => guilds.id, { onDelete: 'cascade' }),
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 16 }).notNull().default('member'),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
  totalDonatedGold: bigint('total_donated_gold', { mode: 'number' }).notNull().default(0),
  totalTaxContributed: bigint('total_tax_contributed', { mode: 'number' }).notNull().default(0),
}, (t) => [primaryKey({ columns: [t.guildId, t.playerId] })]);

export const guildApplications = pgTable('guild_applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  guildId: uuid('guild_id').notNull().references(() => guilds.id, { onDelete: 'cascade' }),
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  message: varchar('message', { length: 120 }).notNull().default(''),
  status: varchar('status', { length: 16 }).notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  reviewedAt: timestamp('reviewed_at'),
});

export const guildTotems = pgTable('guild_totems', {
  id: uuid('id').primaryKey().defaultRandom(),
  guildId: uuid('guild_id').notNull().references(() => guilds.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 16 }).notNull(),
  level: integer('level').notNull().default(1),
  upgradeCost: bigint('upgrade_cost', { mode: 'number' }).notNull().default(100000),
  donatedGold: bigint('donated_gold', { mode: 'number' }).notNull().default(0),
  activatedUntil: timestamp('activated_until'),
  activationCostGold: bigint('activation_cost_gold', { mode: 'number' }).notNull().default(100000),
  boostCostGold: bigint('boost_cost_gold', { mode: 'number' }).notNull().default(500000),
  boostDurationMinutes: integer('boost_duration_minutes').notNull().default(30),
  boostMaxUnits: integer('boost_max_units').notNull().default(48),
  boostedUnits: integer('boosted_units').notNull().default(0),
  boostStartsAt: timestamp('boost_starts_at'),
  boostEndsAt: timestamp('boost_ends_at'),
});

export const guildBoosts = pgTable('guild_boosts', {
  id: uuid('id').primaryKey().defaultRandom(),
  guildId: uuid('guild_id').notNull().references(() => guilds.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 16 }).notNull(),
  isActive: boolean('is_active').notNull().default(false),
  startsAt: timestamp('starts_at'),
  endsAt: timestamp('ends_at'),
  purchasedUnits: integer('purchased_units').notNull().default(0),
});

export const guildNameStyleLogs = pgTable('guild_name_style_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  guildId: uuid('guild_id').notNull().references(() => guilds.id),
  mode: varchar('mode', { length: 16 }).notNull(),
  colors: jsonb('colors').$type<string[]>().default([]),
  costGold: bigint('cost_gold', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const partyBoats = pgTable('party_boats', {
  id: uuid('id').primaryKey().defaultRandom(),
  captainId: uuid('captain_id').notNull().references(() => players.id),
  name: varchar('name', { length: 24 }).notNull().default('无名之船'),
  boatDefinitionId: varchar('boat_definition_id', { length: 64 }).notNull(),
  status: varchar('status', { length: 16 }).notNull().default('active'),
  visibility: varchar('visibility', { length: 16 }).notNull().default('public'),
  joinCode: varchar('join_code', { length: 8 }).notNull().unique(),
  biomeId: varchar('biome_id', { length: 16 }).notNull().default('b_001'),
  helmId: uuid('helm_id'),
  treasuryGold: bigint('treasury_gold', { mode: 'number' }).notNull().default(0),
  rentalEndsAt: timestamp('rental_ends_at'),
  maintenanceDueAt: timestamp('maintenance_due_at'),
  upkeepPaidAt: timestamp('upkeep_paid_at'),
  isPermanent: boolean('is_permanent').notNull().default(false),
  crowdfundingGold: bigint('crowdfunding_gold', { mode: 'number' }).notNull().default(0),
  crowdfundingTarget: bigint('crowdfunding_target', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const boatDefinitions = pgTable('boat_definitions', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  description: varchar('description', { length: 255 }).notNull(),
  capacity: integer('capacity').notNull(),
  hourlyRentGold: bigint('hourly_rent_gold', { mode: 'number' }).notNull(),
  dailyRentGold: bigint('daily_rent_gold', { mode: 'number' }).notNull(),
  permanentPriceGold: bigint('permanent_price_gold', { mode: 'number' }).notNull(),
  maintenanceFourteenDayGold: bigint('maintenance_fourteen_day_gold', { mode: 'number' }).notNull(),
  crewExperienceBonusBasisPoints: integer('crew_experience_bonus_basis_points').notNull().default(0),
  imagePath: varchar('image_path', { length: 255 }).notNull().default(''),
  orderIndex: integer('order_index').notNull().default(0),
});

export const partyBoatMembers = pgTable('party_boat_members', {
  boatId: uuid('boat_id').notNull().references(() => partyBoats.id, { onDelete: 'cascade' }),
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 16 }).notNull().default('crew'),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.boatId, t.playerId] })]);

export const partyBoatInvitations = pgTable('party_boat_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  boatId: uuid('boat_id').notNull().references(() => partyBoats.id, { onDelete: 'cascade' }),
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const partyBoatCrowdfundingContributions = pgTable('party_boat_crowdfunding', {
  id: uuid('id').primaryKey().defaultRandom(),
  boatId: uuid('boat_id').notNull().references(() => partyBoats.id, { onDelete: 'cascade' }),
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  gold: bigint('gold', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const tournaments = pgTable('tournaments', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: varchar('type', { length: 16 }).notNull(), // personal | guild
  sequence: integer('sequence').notNull(),
  status: varchar('status', { length: 16 }).notNull().default('scheduled'),
  biomeId: varchar('biome_id', { length: 16 }).notNull(),
  startAt: timestamp('start_at').notNull(),
  endAt: timestamp('end_at').notNull(),
  minimumGuilds: integer('minimum_guilds').notNull().default(1),
  registeredGuildCount: integer('registered_guild_count').notNull().default(0),
  targets: jsonb('targets').$type<Array<{ fishId: string; rarity: string; pointsPerFish: number }>>().notNull(),
});

export const tournamentRegistrations = pgTable('tournament_registrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tournamentId: uuid('tournament_id').notNull().references(() => tournaments.id, { onDelete: 'cascade' }),
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  guildId: uuid('guild_id'),
  groupId: varchar('group_id', { length: 16 }),
  score: bigint('score', { mode: 'number' }).notNull().default(0),
  rank: integer('rank'),
  registeredAt: timestamp('registered_at').notNull().defaultNow(),
});

export const tournamentCatchEvents = pgTable('tournament_catch_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tournamentId: uuid('tournament_id').notNull().references(() => tournaments.id, { onDelete: 'cascade' }),
  playerId: uuid('player_id').notNull().references(() => players.id),
  guildId: uuid('guild_id'),
  fishId: varchar('fish_id', { length: 64 }).notNull(),
  points: integer('points').notNull(),
  quantity: integer('quantity').notNull().default(1),
  caughtAt: timestamp('caught_at').notNull().defaultNow(),
}, (t) => [index('tournament_catch_idx').on(t.tournamentId, t.playerId)]);

export const tournamentTrophies = pgTable('tournament_trophies', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  allStatBonus: integer('all_stat_bonus').notNull().default(0),
  imagePath: varchar('image_path', { length: 255 }).notNull().default(''),
});

export const playerTrophies = pgTable('player_trophies', {
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  trophyId: varchar('trophy_id', { length: 64 }).notNull().references(() => tournamentTrophies.id),
  earnedAt: timestamp('earned_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.playerId, t.trophyId] })]);

export const weeklyTournamentGroups = pgTable('weekly_tournament_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  cycleSequence: integer('cycle_sequence').notNull(),
  groupPublicId: integer('group_public_id').notNull(),
  playerId: uuid('player_id').notNull().references(() => players.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const weeklyTournamentCatchEvents = pgTable('weekly_tournament_catch_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  cycleSequence: integer('cycle_sequence').notNull(),
  groupPublicId: integer('group_public_id').notNull(),
  playerId: uuid('player_id').notNull().references(() => players.id),
  fishId: varchar('fish_id', { length: 64 }).notNull(),
  points: integer('points').notNull(),
  caughtAt: timestamp('caught_at').notNull().defaultNow(),
});

export const weeklyTournamentMedals = pgTable('weekly_tournament_medals', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  allStatBonus: integer('all_stat_bonus').notNull().default(0),
  imagePath: varchar('image_path', { length: 255 }).notNull().default(''),
  orderIndex: integer('order_index').notNull().default(0),
});

export const playerWeeklyMedals = pgTable('player_weekly_medals', {
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  medalId: varchar('medal_id', { length: 64 }).notNull().references(() => weeklyTournamentMedals.id),
  cycleSequence: integer('cycle_sequence').notNull(),
  rank: integer('rank').notNull(),
  earnedAt: timestamp('earned_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.playerId, t.medalId, t.cycleSequence] })]);

export const arcaneSacrificeRounds = pgTable('arcane_sacrifice_rounds', {
  id: uuid('id').primaryKey().defaultRandom(),
  dayDate: varchar('day_date', { length: 10 }).notNull(),
  roundNumber: integer('round_number').notNull(),
  cycleOrdinal: integer('cycle_ordinal').notNull(),
  resourceType: varchar('resource_type', { length: 16 }).notNull(),
  target: bigint('target', { mode: 'number' }).notNull(),
  progress: bigint('progress', { mode: 'number' }).notNull().default(0),
  status: varchar('status', { length: 16 }).notNull().default('open'),
  opensAt: timestamp('opens_at').notNull(),
  completedAt: timestamp('completed_at'),
  effectEndsAt: timestamp('effect_ends_at'),
});

export const arcaneSacrificeContributions = pgTable('arcane_sacrifice_contributions', {
  id: uuid('id').primaryKey().defaultRandom(),
  roundId: uuid('round_id').notNull().references(() => arcaneSacrificeRounds.id, { onDelete: 'cascade' }),
  playerId: uuid('player_id').notNull().references(() => players.id),
  resourceType: varchar('resource_type', { length: 16 }).notNull(),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('sacrifice_contrib_round_idx').on(t.roundId, t.playerId)]);

export const globalNotifications = pgTable('global_notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: varchar('kind', { length: 32 }).notNull(),
  playerId: uuid('player_id').notNull().references(() => players.id),
  fishId: varchar('fish_id', { length: 64 }),
  quantity: integer('quantity').notNull().default(1),
  startsAt: timestamp('starts_at').notNull().defaultNow(),
  endsAt: timestamp('ends_at').notNull(),
});

export const playerNotificationsRead = pgTable('player_notifications_read', {
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  notificationId: uuid('notification_id').notNull().references(() => globalNotifications.id, { onDelete: 'cascade' }),
  readAt: timestamp('read_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.playerId, t.notificationId] })]);

export const sponsorshipCredits = pgTable('sponsorship_credits', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').notNull().references(() => players.id),
  points: integer('points').notNull().default(0),
  source: varchar('source', { length: 64 }).notNull().default('manual'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const leaderboardSnapshots = pgTable('leaderboard_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  category: varchar('category', { length: 32 }).notNull(),
  date: varchar('date', { length: 10 }).notNull(),
  generatedAt: timestamp('generated_at').notNull().defaultNow(),
  entries: jsonb('entries').$type<Array<{ playerId: string; rank: number; value: number; secondaryValue?: number }>>().notNull(),
}, (t) => [uniqueIndex('lb_cat_date').on(t.category, t.date)]);

export const convenienceEntitlements = pgTable('convenience_entitlements', {
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  productId: varchar('product_id', { length: 64 }).notNull(),
  isActive: boolean('is_active').notNull().default(false),
  endsAt: timestamp('ends_at'),
}, (t) => [primaryKey({ columns: [t.playerId, t.productId] })]);

export const cdkCodes = pgTable('cdk_codes', {
  code: varchar('code', { length: 32 }).primaryKey(),
  kind: varchar('kind', { length: 32 }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  maxRedemptions: integer('max_redemptions').notNull().default(1),
  redemptions: integer('redemptions').notNull().default(0),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const cdkRedemptions = pgTable('cdk_redemptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 32 }).notNull().references(() => cdkCodes.code),
  playerId: uuid('player_id').notNull().references(() => players.id),
  redeemedAt: timestamp('redeemed_at').notNull().defaultNow(),
});

export const playerLoginLogs = pgTable('player_login_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').notNull().references(() => players.id),
  ip: varchar('ip', { length: 64 }),
  userAgent: varchar('user_agent', { length: 255 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const playerStatAllocationLogs = pgTable('player_stat_allocation_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').notNull().references(() => players.id),
  allocation: jsonb('allocation').$type<Record<string, number>>().notNull(),
  costGold: bigint('cost_gold', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const globalSettings = pgTable('global_settings', {
  key: varchar('key', { length: 64 }).primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const exchangeLogs = pgTable('exchange_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').notNull().references(() => players.id),
  kind: varchar('kind', { length: 32 }).notNull(),
  amount: integer('amount').notNull().default(0),
  goldCost: bigint('gold_cost', { mode: 'number' }).notNull().default(0),
  date: varchar('date', { length: 10 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('exchange_logs_player_date').on(t.playerId, t.date)]);

export const bannedPlayers = pgTable('banned_players', {
  playerId: uuid('player_id').primaryKey().references(() => players.id, { onDelete: 'cascade' }),
  reason: varchar('reason', { length: 200 }).notNull().default(''),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const playerStats = pgTable('player_stats', {
  playerId: uuid('player_id').primaryKey().references(() => players.id, { onDelete: 'cascade' }),
  onlineCasts: bigint('online_casts', { mode: 'number' }).notNull().default(0),
  offlineCasts: bigint('offline_casts', { mode: 'number' }).notNull().default(0),
  loginDays: integer('login_days').notNull().default(0),
  lastLoginDate: varchar('last_login_date', { length: 10 }),
  marketTrades: bigint('market_trades', { mode: 'number' }).notNull().default(0),
  personalTournaments: integer('personal_tournaments').notNull().default(0),
  guildTournaments: integer('guild_tournaments').notNull().default(0),
  masteryLevelsGained: integer('mastery_levels_gained').notNull().default(0),
  rodLevelsGained: integer('rod_levels_gained').notNull().default(0),
  firstLegendaryAt: timestamp('first_legendary_at'),
  firstMythicAt: timestamp('first_mythic_at'),
  firstExoticAt: timestamp('first_exotic_at'),
  firstArcaneAt: timestamp('first_arcane_at'),
});

export const playerWeatherCasts = pgTable('player_weather_casts', {
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  weatherId: varchar('weather_id', { length: 32 }).notNull(),
  casts: bigint('casts', { mode: 'number' }).notNull().default(0),
}, (t) => [primaryKey({ columns: [t.playerId, t.weatherId] })]);

export const playerBaitCasts = pgTable('player_bait_casts', {
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  baitId: varchar('bait_id', { length: 32 }).notNull(),
  casts: bigint('casts', { mode: 'number' }).notNull().default(0),
}, (t) => [primaryKey({ columns: [t.playerId, t.baitId] })]);

export const playerBiomeCasts = pgTable('player_biome_casts', {
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  biomeId: varchar('biome_id', { length: 16 }).notNull(),
  casts: bigint('casts', { mode: 'number' }).notNull().default(0),
}, (t) => [primaryKey({ columns: [t.playerId, t.biomeId] })]);

export const playerReincarnations = pgTable('player_reincarnations', {
  playerId: uuid('player_id').primaryKey().references(() => players.id, { onDelete: 'cascade' }),
  round: integer('round').notNull().default(0),
  strengthPoints: integer('strength_points').notNull().default(0),
  intelligencePoints: integer('intelligence_points').notNull().default(0),
  luckPoints: integer('luck_points').notNull().default(0),
  endurancePoints: integer('endurance_points').notNull().default(0),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const lighthouseArtifacts = pgTable('lighthouse_artifacts', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  description: varchar('description', { length: 255 }).notNull(),
  statType: varchar('stat_type', { length: 16 }).notNull(),
  baseBonus: integer('base_bonus').notNull().default(1),
  maxLevel: integer('max_level').notNull().default(20),
  upgradeRelicBase: integer('upgrade_relic_base').notNull().default(10),
  upgradeRelicGrowth: real('upgrade_relic_growth').notNull().default(1.5),
  icon: varchar('icon', { length: 32 }).notNull().default('sparkles'),
  orderIndex: integer('order_index').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
});

export const playerArtifacts = pgTable('player_artifacts', {
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  artifactId: varchar('artifact_id', { length: 64 }).notNull().references(() => lighthouseArtifacts.id, { onDelete: 'cascade' }),
  level: integer('level').notNull().default(1),
  acquiredAt: timestamp('acquired_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.playerId, t.artifactId] })]);

export const lighthouseLotteryDraws = pgTable('lighthouse_lottery_draws', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  costRelics: integer('cost_relics').notNull().default(0),
  rewardType: varchar('reward_type', { length: 32 }).notNull(),
  rewardId: varchar('reward_id', { length: 64 }),
  rewardAmount: integer('reward_amount').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('lighthouse_draws_player_idx').on(t.playerId, t.createdAt)]);

export const adminAuditLogs = pgTable('admin_audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  actor: varchar('actor', { length: 64 }).notNull().default('admin'),
  action: varchar('action', { length: 64 }).notNull(),
  targetType: varchar('target_type', { length: 32 }).notNull(),
  targetId: varchar('target_id', { length: 128 }),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('admin_audit_time_idx').on(t.createdAt)]);

export const worldBosses = pgTable('world_bosses', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  description: varchar('description', { length: 255 }).notNull(),
  biomeId: varchar('biome_id', { length: 16 }).notNull(),
  maxHp: bigint('max_hp', { mode: 'number' }).notNull(),
  currentHp: bigint('current_hp', { mode: 'number' }).notNull(),
  startsAt: timestamp('starts_at').notNull(),
  endsAt: timestamp('ends_at').notNull(),
  status: varchar('status', { length: 16 }).notNull().default('scheduled'),
  rewardRelics: integer('reward_relics').notNull().default(0),
  rewardFragments: integer('reward_fragments').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const worldBossDamage = pgTable('world_boss_damage', {
  bossId: varchar('boss_id', { length: 64 }).notNull().references(() => worldBosses.id, { onDelete: 'cascade' }),
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  damage: bigint('damage', { mode: 'number' }).notNull().default(0),
  attacks: integer('attacks').notNull().default(0),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.bossId, t.playerId] })]);

export const announcements = pgTable('announcements', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 80 }).notNull(),
  body: text('body').notNull(),
  level: varchar('level', { length: 16 }).notNull().default('info'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'),
});
