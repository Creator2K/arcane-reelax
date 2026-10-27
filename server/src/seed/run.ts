import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { db, pool } from '../db/client.js';
import * as schema from '../db/schema.js';
import { sql } from 'drizzle-orm';
import argon2 from 'argon2';
import { DEFAULT_SITE_BRANDING, DEFAULT_MAIL_CONFIG, DEFAULT_REGISTRATION_POLICY } from '../services/siteConfig.js';
import { ONLINE_GEAR_TEMPLATES, gearSeedStatRange } from '../services/gearGeneration.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const content: any = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'content.json'), 'utf8'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const achData: any = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'achievements.json'), 'utf8'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const masteryData: any = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'mastery.json'), 'utf8'));
const shopAvatarData: any[] = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'shopAvatars.json'), 'utf8'));

type RodSeed = typeof schema.rods.$inferInsert;
const RODS: RodSeed[] = [
  { id: 'novice_rod', name: '潮木新手竿', description: '可靠的入门鱼竿，无额外属性', requiredLevel: 1, purchaseCost: 0, maxLevel: 1, statPerLevel: {}, specialEffect: null },
  { id: 'strength_rod', name: '力量鱼竿', description: '每级提供 20 点力量', requiredLevel: 1, purchaseCost: 15000, baseUpgradeCost: 5000, upgradeCostGrowth: 1.25, maxLevel: 500, statPerLevel: { strength: 20 } },
  { id: 'intelligence_rod', name: '智力鱼竿', description: '每级提供 20 点智力', requiredLevel: 1, purchaseCost: 15000, baseUpgradeCost: 5000, upgradeCostGrowth: 1.25, maxLevel: 500, statPerLevel: { intelligence: 20 } },
  { id: 'luck_rod', name: '运气鱼竿', description: '每级提供 20 点运气', requiredLevel: 1, purchaseCost: 15000, baseUpgradeCost: 5000, upgradeCostGrowth: 1.25, maxLevel: 500, statPerLevel: { luck: 20 } },
  { id: 'endurance_rod', name: '耐力鱼竿', description: '每级提供 20 点耐力', requiredLevel: 1, purchaseCost: 15000, baseUpgradeCost: 5000, upgradeCostGrowth: 1.25, maxLevel: 500, statPerLevel: { endurance: 20 } },
  { id: 'gear_rod', name: '寻珍鱼竿', description: '普通装备主掉落权重 +2.5%', requiredLevel: 1, purchaseCost: 25000, maxLevel: 1, statPerLevel: {}, specialEffect: { kind: 'gear_weight', value: 250 } },
  { id: 'chest_rod', name: '探匣鱼竿', description: '宝箱主掉落权重 +2.5%', requiredLevel: 1, purchaseCost: 25000, maxLevel: 1, statPerLevel: {}, specialEffect: { kind: 'chest_weight', value: 250 } },
  { id: 'strength_intelligence_rod', name: '力量·智力鱼竿', description: '每级提供 15 点力量与智力', requiredLevel: 2000, purchaseCost: 20000, baseUpgradeCost: 20000, upgradeCostGrowth: 1.25, maxLevel: 500, statPerLevel: { strength: 15, intelligence: 15 } },
  { id: 'strength_luck_rod', name: '力量·运气鱼竿', description: '每级提供 15 点力量与运气', requiredLevel: 2000, purchaseCost: 20000, baseUpgradeCost: 20000, upgradeCostGrowth: 1.25, maxLevel: 500, statPerLevel: { strength: 15, luck: 15 } },
  { id: 'strength_endurance_rod', name: '力量·耐力鱼竿', description: '每级提供 15 点力量与耐力', requiredLevel: 2000, purchaseCost: 20000, baseUpgradeCost: 20000, upgradeCostGrowth: 1.25, maxLevel: 500, statPerLevel: { strength: 15, endurance: 15 } },
  { id: 'intelligence_luck_rod', name: '智力·运气鱼竿', description: '每级提供 15 点智力与运气', requiredLevel: 2000, purchaseCost: 20000, baseUpgradeCost: 20000, upgradeCostGrowth: 1.25, maxLevel: 500, statPerLevel: { intelligence: 15, luck: 15 } },
  { id: 'intelligence_endurance_rod', name: '智力·耐力鱼竿', description: '每级提供 15 点智力与耐力', requiredLevel: 2000, purchaseCost: 20000, baseUpgradeCost: 20000, upgradeCostGrowth: 1.25, maxLevel: 500, statPerLevel: { intelligence: 15, endurance: 15 } },
  { id: 'luck_endurance_rod', name: '运气·耐力鱼竿', description: '每级提供 15 点运气与耐力', requiredLevel: 2000, purchaseCost: 20000, baseUpgradeCost: 20000, upgradeCostGrowth: 1.25, maxLevel: 500, statPerLevel: { luck: 15, endurance: 15 } },
];

const CHESTS = [
  {
    id: 'rusted_gear_chest', name: '锈蚀宝箱', price: 25000,
    paymentOptions: [{ currency: 'gold', unitPrice: 25000, dailyLimit: null }],
    rarityChances: [
      { rarity: 'common', chancePermille: 600 }, { rarity: 'uncommon', chancePermille: 250 },
      { rarity: 'fine', chancePermille: 100 }, { rarity: 'rare', chancePermille: 40 },
      { rarity: 'epic', chancePermille: 10 },
    ],
  },
  {
    id: 'magic_gear_chest', name: '魔法宝箱', price: 250000,
    paymentOptions: [{ currency: 'gold', unitPrice: 250000, dailyLimit: null }],
    rarityChances: [
      { rarity: 'uncommon', chancePermille: 200 }, { rarity: 'fine', chancePermille: 400 },
      { rarity: 'rare', chancePermille: 200 }, { rarity: 'epic', chancePermille: 150 },
      { rarity: 'legendary', chancePermille: 40 }, { rarity: 'mythic', chancePermille: 10 },
    ],
  },
  {
    id: 'mysterious_gear_chest', name: '神话宝箱', price: 500000,
    paymentOptions: [{ currency: 'gold', unitPrice: 500000, dailyLimit: null }],
    rarityChances: [
      { rarity: 'fine', chancePermille: 400 }, { rarity: 'rare', chancePermille: 300 },
      { rarity: 'epic', chancePermille: 200 }, { rarity: 'legendary', chancePermille: 75 },
      { rarity: 'mythic', chancePermille: 20 }, { rarity: 'exotic', chancePermille: 5 },
    ],
  },
  {
    id: 'arcane_gear_chest', name: '奥术宝箱', price: 1000000,
    paymentOptions: [
      { currency: 'gold', unitPrice: 1000000, dailyLimit: 50 },
      { currency: 'relic', unitPrice: 800, dailyLimit: 25 },
      { currency: 'fragment', unitPrice: 80, dailyLimit: 25 },
    ],
    rarityChances: [
      { rarity: 'fine', chancePermille: 50 }, { rarity: 'rare', chancePermille: 350 },
      { rarity: 'epic', chancePermille: 400 }, { rarity: 'legendary', chancePermille: 160 },
      { rarity: 'mythic', chancePermille: 30 }, { rarity: 'exotic', chancePermille: 9 },
      { rarity: 'arcane', chancePermille: 1 },
    ],
  },
];

const SHOP_BUFFS = [
  { id: 'relic-xp-i', name: '潮痕研习 I', description: '个人经验 +30%', shop: 'relic', currency: 'relic', productType: 'personal_buff', price: 75, buffCategory: 'experience', bonusBasisPoints: 3000, durationSeconds: 1800, isGlobal: false },
  { id: 'relic-xp-ii', name: '潮痕研习 II', description: '个人经验 +75%', shop: 'relic', currency: 'relic', productType: 'personal_buff', price: 150, buffCategory: 'experience', bonusBasisPoints: 7500, durationSeconds: 1800, isGlobal: false },
  { id: 'relic-strength-i', name: '渊流臂力 I', description: '有效力量 +10%', shop: 'relic', currency: 'relic', productType: 'personal_buff', price: 75, buffCategory: 'strength', bonusBasisPoints: 1000, durationSeconds: 1800, isGlobal: false },
  { id: 'relic-strength-ii', name: '渊流臂力 II', description: '有效力量 +25%', shop: 'relic', currency: 'relic', productType: 'personal_buff', price: 150, buffCategory: 'strength', bonusBasisPoints: 2500, durationSeconds: 1800, isGlobal: false },
  { id: 'relic-luck-i', name: '星鳞灵感 I', description: '有效运气 +10%', shop: 'relic', currency: 'relic', productType: 'personal_buff', price: 75, buffCategory: 'luck', bonusBasisPoints: 1000, durationSeconds: 1800, isGlobal: false },
  { id: 'relic-luck-ii', name: '星鳞灵感 II', description: '有效运气 +25%', shop: 'relic', currency: 'relic', productType: 'personal_buff', price: 150, buffCategory: 'luck', bonusBasisPoints: 2500, durationSeconds: 1800, isGlobal: false },
  { id: 'fragment-xp', name: '万流共鸣', description: '全服经验 +50%', shop: 'fragment', currency: 'fragment', productType: 'global_buff', price: 50, buffCategory: 'experience', bonusBasisPoints: 5000, durationSeconds: 7200, isGlobal: true },
  { id: 'fragment-gold', name: '淘金热潮', description: '全服每杆直接金币 +50%', shop: 'fragment', currency: 'fragment', productType: 'global_buff', price: 100, buffCategory: 'gold', bonusBasisPoints: 5000, durationSeconds: 7200, isGlobal: true },
];

const TALENTS = [
  { id: 'seasoned_angler', name: '渊博垂钓者', description: '所有地图抛竿经验 +5%', effectKind: 'global_xp_basis_points', effectPerRank: 500, maxRank: 10 },
  { id: 'steady_income_i', name: '稳定收益 I', description: '每杆直接金币最大值 +100', effectKind: 'direct_gold_max', effectPerRank: 100, maxRank: 10 },
  { id: 'steady_income_ii', name: '稳定收益 II', description: '每杆直接金币最小值 +50', effectKind: 'direct_gold_min', effectPerRank: 50, maxRank: 10, prerequisiteTalentId: 'steady_income_i', prerequisiteRank: 1 },
  { id: 'gilded_instinct_i', name: '金风感知 I', description: '金风时直接金币最大值额外 +300', effectKind: 'gilded_gold_max', effectPerRank: 300, maxRank: 10 },
  { id: 'gilded_instinct_ii', name: '金风感知 II', description: '金风时直接金币最小值额外 +100', effectKind: 'gilded_gold_min', effectPerRank: 100, maxRank: 10, prerequisiteTalentId: 'gilded_instinct_i', prerequisiteRank: 1 },
];

const BOAT_DEFINITIONS = [
  { id: 'reedwake_dinghy', name: '芦汐轻舟', description: '苇草与潮汐织成的小舟，适合三五好友同航。', capacity: 3, hourlyRentGold: 150000, dailyRentGold: 1500000, permanentPriceGold: 15000000, maintenanceFourteenDayGold: 1500000, crewExperienceBonusBasisPoints: 1000, imagePath: '/party-boats/reedwake-dinghy.webp' },
  { id: 'mistglass_cutter', name: '雾镜快船', description: '雾港常用的快船，稳当可靠。', capacity: 4, hourlyRentGold: 250000, dailyRentGold: 2500000, permanentPriceGold: 50000000, maintenanceFourteenDayGold: 5000000, crewExperienceBonusBasisPoints: 1500, imagePath: '/party-boats/mistglass-cutter.webp' },
  { id: 'starweave_sloop', name: '星织单桅船', description: '单桅纵帆，夜色里桅灯如星。', capacity: 5, hourlyRentGold: 500000, dailyRentGold: 5000000, permanentPriceGold: 125000000, maintenanceFourteenDayGold: 12500000, crewExperienceBonusBasisPoints: 2000, imagePath: '/party-boats/starweave-sloop.webp' },
  { id: 'stormrail_brig', name: '雷舷双桅船', description: '双桅横帆，能扛住雷暴航线的重船。', capacity: 6, hourlyRentGold: 750000, dailyRentGold: 7500000, permanentPriceGold: 250000000, maintenanceFourteenDayGold: 25000000, crewExperienceBonusBasisPoints: 2500, imagePath: '/party-boats/stormrail-brig.webp' },
  { id: 'arcane_tide_galleon', name: '奥潮远洋舰', description: '承载奥术力量的大型远洋舰。', capacity: 7, hourlyRentGold: 1000000, dailyRentGold: 10000000, permanentPriceGold: 500000000, maintenanceFourteenDayGold: 50000000, crewExperienceBonusBasisPoints: 3000, imagePath: '/party-boats/arcane-tide-galleon.webp' },
];

const TROPHIES = [
  { id: 'arcane_chaser', name: '奥术追逐者', allStatBonus: 5 },
  { id: 'arcane_chased', name: '被奥术追逐者', allStatBonus: 5 },
];

const WEEKLY_MEDALS = [
  { id: 'weekly_gold', name: '周赛金牌', allStatBonus: 6, orderIndex: 0 },
  { id: 'weekly_silver', name: '周赛银牌', allStatBonus: 4, orderIndex: 1 },
  { id: 'weekly_bronze', name: '周赛铜牌', allStatBonus: 3, orderIndex: 2 },
  { id: 'weekly_iron', name: '周赛铁牌', allStatBonus: 2, orderIndex: 3 },
  { id: 'weekly_stone', name: '周赛石牌', allStatBonus: 1, orderIndex: 4 },
  { id: 'weekly_wood', name: '周赛木牌', allStatBonus: 0, orderIndex: 5 },
];

const QUEST_TEMPLATES = [
  // daily - 5 tasks, 50 relics each, reroll 100000
  { period: 'daily', slot: 1, category: 'fishing', objectiveType: 'casts_in_mode', descriptionTemplate: '以在线模式结算 {target} 次抛竿', target: 300, rewardRelics: 50, settlementMode: 'online', weight: 10 },
  { period: 'daily', slot: 2, category: 'conditions', objectiveType: 'casts_in_weather', descriptionTemplate: '在{weather}中结算 {target} 次抛竿', target: 310, rewardRelics: 50, weatherId: 'rain', weight: 10 },
  { period: 'daily', slot: 3, category: 'exploration', objectiveType: 'fish_in_biome', descriptionTemplate: '在{biome}收获 {target} 条鱼', target: 540, rewardRelics: 50, biomeId: 'b_001', weight: 10 },
  { period: 'daily', slot: 4, category: 'conditions', objectiveType: 'casts_in_weather', descriptionTemplate: '在{weather}中结算 {target} 次抛竿', target: 370, rewardRelics: 50, weatherId: 'heatwave', weight: 10 },
  { period: 'daily', slot: 5, category: 'resources', objectiveType: 'fish_with_specific_bait', descriptionTemplate: '使用{baittier}收获 {target} 条鱼', target: 150, rewardRelics: 50, baitTier: 'low', weight: 10 },
  // weekly - 5 tasks, 150 relics each
  { period: 'weekly', slot: 1, category: 'fishing', objectiveType: 'casts_total', descriptionTemplate: '结算 {target} 次抛竿', target: 7700, rewardRelics: 150, weight: 10 },
  { period: 'weekly', slot: 2, category: 'discovery', objectiveType: 'fish_rarity_at_least', descriptionTemplate: '收获 {target} 条精良及以上鱼获', target: 700, rewardRelics: 150, rarity: 'fine', weight: 10 },
  { period: 'weekly', slot: 3, category: 'discovery', objectiveType: 'fish_rarity_at_least', descriptionTemplate: '收获 {target} 条史诗及以上鱼获', target: 325, rewardRelics: 150, rarity: 'epic', weight: 10 },
  { period: 'weekly', slot: 4, category: 'fishing', objectiveType: 'casts_in_mode', descriptionTemplate: '以在线模式结算 {target} 次抛竿', target: 3700, rewardRelics: 150, settlementMode: 'online', weight: 10 },
  { period: 'weekly', slot: 5, category: 'exploration', objectiveType: 'fish_in_biome', descriptionTemplate: '在{biome}收获 {target} 条鱼', target: 9600, rewardRelics: 150, biomeId: 'b_002', weight: 10 },
  // monthly - 5 tasks, 300 relics each
  { period: 'monthly', slot: 1, category: 'fishing', objectiveType: 'fish_total', descriptionTemplate: '收获 {target} 条鱼', target: 33100, rewardRelics: 300, weight: 10 },
  { period: 'monthly', slot: 2, category: 'exploration', objectiveType: 'fish_in_biome', descriptionTemplate: '在{biome}收获 {target} 条鱼', target: 21000, rewardRelics: 300, biomeId: 'b_003', weight: 10 },
  { period: 'monthly', slot: 3, category: 'fishing', objectiveType: 'casts_total', descriptionTemplate: '结算 {target} 次抛竿', target: 15700, rewardRelics: 300, weight: 10 },
  { period: 'monthly', slot: 4, category: 'conditions', objectiveType: 'casts_in_weather', descriptionTemplate: '在{weather}中结算 {target} 次抛竿', target: 16100, rewardRelics: 300, weatherId: 'gale', weight: 10 },
  { period: 'monthly', slot: 5, category: 'conditions', objectiveType: 'casts_in_weather', descriptionTemplate: '在{weather}中结算 {target} 次抛竿', target: 15200, rewardRelics: 300, weatherId: 'clear', weight: 10 },
];

const LIGHTHOUSE_ARTIFACTS = [
  { id: 'strength_gift', name: '力量恩赐', description: '每级提供 5 点力量。', statType: 'strength', baseBonus: 5, maxLevel: 500, upgradeRelicBase: 10, upgradeRelicGrowth: 1.25, icon: 'flame', orderIndex: 0 },
  { id: 'intelligence_gift', name: '智慧恩赐', description: '每级提供 5 点智力。', statType: 'intelligence', baseBonus: 5, maxLevel: 500, upgradeRelicBase: 10, upgradeRelicGrowth: 1.25, icon: 'compass', orderIndex: 1 },
  { id: 'luck_gift', name: '幸运恩赐', description: '每级提供 5 点运气。', statType: 'luck', baseBonus: 5, maxLevel: 500, upgradeRelicBase: 10, upgradeRelicGrowth: 1.25, icon: 'moon', orderIndex: 2 },
  { id: 'endurance_gift', name: '耐力恩赐', description: '每级提供 5 点耐力。', statType: 'endurance', baseBonus: 5, maxLevel: 500, upgradeRelicBase: 10, upgradeRelicGrowth: 1.25, icon: 'bell', orderIndex: 3 },
  { id: 'four_saints_power', name: '四圣之力', description: '每级提供全属性 +2。', statType: 'all', baseBonus: 2, maxLevel: 500, upgradeRelicBase: 20, upgradeRelicGrowth: 1.3, icon: 'sparkles', orderIndex: 4 },
  { id: 'sea_king_gift', name: '海王恩赐', description: '每级提高钓鱼直接金币上限 +3。', statType: 'direct_gold_max', baseBonus: 3, maxLevel: 500, upgradeRelicBase: 15, upgradeRelicGrowth: 1.3, icon: 'waves', orderIndex: 5 },
  { id: 'fortune_gift', name: '财运恩赐', description: '每级提高钓鱼直接金币下限 +3。', statType: 'direct_gold_min', baseBonus: 3, maxLevel: 500, upgradeRelicBase: 15, upgradeRelicGrowth: 1.3, icon: 'coins', orderIndex: 6 },
  { id: 'experience_gift', name: '经验恩赐', description: '每级提高经验获取 +0.2%。', statType: 'experience', baseBonus: 2, maxLevel: 500, upgradeRelicBase: 20, upgradeRelicGrowth: 1.35, icon: 'star', orderIndex: 7 },
  { id: 'competition_banner', name: '竞潮战旗', description: '每级提高个人赛、公会赛得分 +0.05%。', statType: 'competition', baseBonus: 5, maxLevel: 500, upgradeRelicBase: 20, upgradeRelicGrowth: 1.35, icon: 'flag', orderIndex: 8 },
  { id: 'strength_totem', name: '力量图腾', description: '每级提高总力量 +0.05%。', statType: 'strength_pct', baseBonus: 5, maxLevel: 500, upgradeRelicBase: 25, upgradeRelicGrowth: 1.35, icon: 'flame', orderIndex: 9 },
  { id: 'intelligence_totem', name: '智慧图腾', description: '每级提高总智力 +0.05%。', statType: 'intelligence_pct', baseBonus: 5, maxLevel: 500, upgradeRelicBase: 25, upgradeRelicGrowth: 1.35, icon: 'compass', orderIndex: 10 },
  { id: 'luck_totem', name: '幸运图腾', description: '每级提高总运气 +0.05%。', statType: 'luck_pct', baseBonus: 5, maxLevel: 500, upgradeRelicBase: 25, upgradeRelicGrowth: 1.35, icon: 'moon', orderIndex: 11 },
  { id: 'endurance_totem', name: '耐力图腾', description: '每级提高总耐力 +0.05%。', statType: 'endurance_pct', baseBonus: 5, maxLevel: 500, upgradeRelicBase: 25, upgradeRelicGrowth: 1.35, icon: 'bell', orderIndex: 12 },
];

function chinaDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const china = new Date(d.getTime() + 8 * 3600 * 1000);
  return `${china.getUTCFullYear()}-${p(china.getUTCMonth() + 1)}-${p(china.getUTCDate())}`;
}

async function clearAll() {
  const tables = [
    'admin_audit_logs', 'announcements', 'world_boss_damage', 'world_bosses', 'lighthouse_lottery_draws', 'player_artifacts', 'lighthouse_artifacts', 'player_reincarnations', 'player_stat_allocation_logs', 'player_login_logs', 'cdk_redemptions', 'cdk_codes',
    'player_notifications_read', 'global_notifications', 'arcane_sacrifice_contributions',
    'arcane_sacrifice_rounds', 'player_weekly_medals', 'weekly_tournament_medals', 'weekly_tournament_catch_events',
    'weekly_tournament_groups', 'player_trophies', 'tournament_trophies', 'tournament_catch_events',
    'tournament_registrations', 'tournaments', 'party_boat_crowdfunding', 'party_boat_invitations',
    'party_boat_members', 'party_boats', 'boat_definitions', 'guild_name_style_logs', 'guild_boosts',
    'guild_totems', 'guild_applications', 'guild_members', 'guilds', 'global_buffs', 'player_buffs',
    'shop_buffs', 'convenience_purchases', 'convenience_entitlements', 'barter_trades', 'barter_offers',
    'market_trades', 'market_orders', 'daily_check_ins', 'daily_harvest', 'fishing_runs',
    'player_quests', 'quest_templates', 'player_achievements', 'achievement_definitions', 'titles',
    'avatars', 'player_avatars', 'player_mastery_progress', 'mastery_targets', 'player_inventory_fish',
    'player_baits', 'player_rods', 'player_biomes', 'player_chests', 'chests', 'gear_items',
    'gear_templates', 'weather', 'baits', 'rods', 'fish', 'biomes', 'content_meta',
    'players', 'sessions', 'accounts', 'leaderboard_snapshots', 'player_talents', 'talents',
    'sponsorship_credits', 'global_settings',
  ];
  for (const t of tables) {
    await db.execute(sql`TRUNCATE TABLE ${sql.identifier(t)} CASCADE`);
  }
  console.log('cleared all tables');
}

async function seed() {
  await clearAll();

  await db.insert(schema.contentMeta).values({
    id: 'main',
    contentVersion: content.contentVersion,
    statResetCostGold: content.statResetCostGold,
  });

  await db.insert(schema.biomes).values(content.biomes.map((b: any, i: number) => ({
    ...b,
    orderIndex: i,
    directGoldMin: b.directGoldMin ?? 50,
    directGoldMax: b.directGoldMax ?? 100,
  })));

  await db.insert(schema.fish).values(content.fish.map((f: any) => ({
    id: f.id, name: f.name, description: f.description, biomeId: f.biomeId,
    rarity: f.rarity, sellPrice: f.sellPrice, imagePath: f.imagePath,
  })));
  console.log('fish seeded:', content.fish.length);

  await db.insert(schema.rods).values(content.rods.map((r: any, i: number) => ({
    ...r,
    orderIndex: i,
    baseUpgradeCost: r.baseUpgradeCost ?? 0,
    upgradeCostGrowth: r.upgradeCostGrowth ?? 1,
    specialEffect: r.gearCategoryMultiplier
      ? { kind: 'gear_weight', value: Math.round((r.gearCategoryMultiplier - 1) * 10000) }
      : r.chestCategoryMultiplier
        ? { kind: 'chest_weight', value: Math.round((r.chestCategoryMultiplier - 1) * 10000) }
        : null,
  })));
  await db.insert(schema.baits).values(content.baits.map((b: any, i: number) => ({
    id: b.id,
    tier: b.tier,
    name: b.name,
    unitPrice: b.unitPrice ?? 0,
    luck: b.luck ?? 0,
    minRarityIndex: b.minRarity ?? b.minRarityIndex ?? 0,
    maxRarityIndex: b.maxRarity ?? b.maxRarityIndex ?? 1,
    fishRarityMultipliers: b.fishRarityMultipliers ?? {},
    allowsRelic: Boolean(b.allowsRelic),
    allowsGear: Boolean(b.allowsGear),
    allowsChest: Boolean(b.allowsChest),
    isUnlimited: Boolean(b.isUnlimited),
    orderIndex: i,
  })));
  await db.insert(schema.weather).values(content.weather.map((w: any, i: number) => ({ ...w, orderIndex: i })));

  const gearRows: Array<typeof schema.gearTemplates.$inferInsert> = ONLINE_GEAR_TEMPLATES.map((template) => ({
    id: template.id,
    name: template.name,
    slot: template.slot,
    minQuality: 0,
    maxQuality: 100,
    baseStatRange: gearSeedStatRange(template),
    sourceBiomeId: null,
    minRarityIndex: 0,
    maxRarityIndex: 8,
    upgradeGoldBase: 13_125,
    upgradeGoldGrowth: 1.75,
    upgradeRelicBase: 0,
    upgradeRelicGrowth: 1,
    salvageRelicMin: 0,
    salvageRelicMax: 0,
    canReroll: true,
  }));
  await db.insert(schema.gearTemplates).values(gearRows);
  console.log('gear templates seeded:', gearRows.length);

  await db.insert(schema.chests).values(CHESTS.map((c, i) => ({ ...c, orderIndex: i })));
  await db.insert(schema.shopBuffs).values(SHOP_BUFFS.map((b, i) => ({ ...b, orderIndex: i })));
  await db.insert(schema.talents).values(TALENTS.map((t, i) => ({ ...t, orderIndex: i })));
  await db.insert(schema.boatDefinitions).values(BOAT_DEFINITIONS.map((b, i) => ({ ...b, orderIndex: i })));
  await db.insert(schema.tournamentTrophies).values(TROPHIES);
  await db.insert(schema.weeklyTournamentMedals).values(WEEKLY_MEDALS);

  const avatarRows = content.avatars.map((a: any, i: number) => ({ id: a.id, name: a.name, imagePath: a.imagePath, source: 'base', isActive: true, orderIndex: i }));
  shopAvatarData.forEach((a, i) => avatarRows.push({
    id: a.id, name: a.name, imagePath: `/api/avatars/${a.id}/image`, source: 'shop',
    priceRelics: a.currency === 'relic' ? a.price : null, priceFragments: a.currency === 'fragment' ? a.price : null, isActive: true,
    orderIndex: 10 + i,
  }));
  await db.insert(schema.avatars).values(avatarRows);

  await db.insert(schema.titles).values(achData.titles.map((t: any, i: number) => ({ ...t, orderIndex: i })));
  await db.insert(schema.achievementDefinitions).values(achData.achievements.map((a: any, i: number) => ({
    ...a, seriesName: a.seriesId ? ({ 'sponsorship-milestones': '同行里程碑', 'total-casts': '万竿入海', 'total-fish': '鱼篓长歌', 'online-casts': '临水守候', 'offline-casts': '离岸余韵', 'biome-casts-b_001': '月落溪谷钓志', 'biome-casts-b_002': '雾语湿地钓志', 'biome-casts-b_003': '镜潮海岸钓志', 'biome-casts-b_004': '雷痕峡湾钓志', 'biome-casts-b_005': '星根洞窟钓志', 'biome-casts-b_006': '霞栖湖原钓志', 'biome-casts-b_007': '云汐悬湖钓志', 'biome-casts-b_008': '赤砂涌泉钓志', 'biome-casts-b_009': '极昼冰湾钓志', 'biome-casts-b_010': '沉钟古港钓志', 'biome-casts-b_011': '翡翠洪林钓志', 'biome-casts-b_012': '熔潮环礁钓志', 'biome-casts-b_013': '天穹鲸海钓志', 'biome-casts-b_014': '时镜回流钓志', 'biome-casts-b_015': '星渊圣海钓志', 'biome-casts-b_016': '永烬炉海钓志', 'biome-casts-b_017': '回环岁海钓志', 'weather-casts-clear': '晴朗观测', 'weather-casts-rain': '雨幕观测', 'weather-casts-gale': '强风观测', 'weather-casts-mist': '浓雾观测', 'weather-casts-heatwave': '热浪观测', 'weather-casts-tempest': '雷暴观测', 'weather-casts-wither_tide': '枯潮观测', 'weather-casts-gilded_current': '金风观测', 'weather-casts-arcane_surge': '奥秘涌流观测', 'bait-casts-basic': '基础饵运用', 'bait-casts-low': '低级饵运用', 'bait-casts-medium': '中级饵运用', 'bait-casts-high': '高级饵运用', 'bait-casts-supreme': '顶级饵运用', 'login-days': '水岸相逢', 'personal-tournaments': '个人赛历练', 'guild-tournaments': '公会赛同舟', 'fishing-relics': '遗物寻踪', 'chests-dropped': '潮中宝箱', 'gear-dropped': '水下钓具', 'chests-opened': '开箱见珍', 'biome-collection-b_001': '月落溪谷图鉴', 'biome-collection-b_002': '雾语湿地图鉴', 'biome-collection-b_003': '镜潮海岸图鉴', 'biome-collection-b_004': '雷痕峡湾图鉴', 'biome-collection-b_005': '星根洞窟图鉴', 'biome-collection-b_006': '霞栖湖原图鉴', 'biome-collection-b_007': '云汐悬湖图鉴', 'biome-collection-b_008': '赤砂涌泉图鉴', 'biome-collection-b_009': '极昼冰湾图鉴', 'biome-collection-b_010': '沉钟古港图鉴', 'biome-collection-b_011': '翡翠洪林图鉴', 'biome-collection-b_012': '熔潮环礁图鉴', 'biome-collection-b_013': '天穹鲸海图鉴', 'biome-collection-b_014': '时镜回流图鉴', 'biome-collection-b_015': '星渊圣海图鉴' } as Record<string, string>)[a.seriesId] ?? null : null,
    seriesStep: a.seriesStep ?? null, seriesTotalSteps: a.seriesTotalSteps ?? null, orderIndex: i,
  })));
  console.log('achievements seeded:', achData.achievements.length, 'titles:', achData.titles.length);

  await db.insert(schema.masteryTargets).values(masteryData.targets.map((t: any) => ({
    ...t,
    id: `${t.biomeId}_${t.rarity}_lv${t.levelIndex}`,
  })));
  console.log('mastery targets seeded:', masteryData.targets.length);

  await db.insert(schema.questTemplates).values(QUEST_TEMPLATES.map((q) => ({
    ...q,
    id: `quest_${q.period}_${q.slot}`,
  })));

  await db.insert(schema.lighthouseArtifacts).values(LIGHTHOUSE_ARTIFACTS);
  await db.insert(schema.worldBosses).values({
    id: 'tide_devourer',
    name: '潮渊吞舟兽',
    description: '从星渊浮上的古老巨影，正沿着沉钟古港的暗流逼近水面。',
    biomeId: 'b_010',
    maxHp: 5_000_000,
    currentHp: 5_000_000,
    startsAt: new Date(Date.now() - 3600_000),
    endsAt: new Date(Date.now() + 24 * 3600_000),
    status: 'active',
    rewardRelics: 250,
    rewardFragments: 25,
  });

  await db.insert(schema.announcements).values({
    title: '潮汐秘典 × 复刻计划',
    body: '本轮测试已开放 17 张地图、1122 种鱼、灯塔神器、世界首领和完整管理后台。',
    level: 'info',
    isActive: true,
  });

  const testEmail = process.env.TEST_USER_EMAIL;
  const testPassword = process.env.TEST_USER_PASSWORD;
  if (testEmail && testPassword) {
    const passwordHash = await argon2.hash(testPassword);
    const account = (await db.insert(schema.accounts).values({
      email: testEmail.toLowerCase(),
      passwordHash,
    }).returning())[0];
    const player = (await db.insert(schema.players).values({
      accountId: account.id,
      publicId: 10001,
      nickname: '潮汐作者',
      level: 120,
      experience: 180000,
      gold: 12_500_000,
      relics: 2600,
      fragments: 320,
      unspentStatPoints: 160,
      currentBiomeId: 'b_010',
      equippedRodId: 'intelligence_luck_rod',
      selectedBaitId: 'bait_high',
      baseStrength: 180,
      baseIntelligence: 240,
      baseLuck: 210,
      baseEndurance: 180,
      totalCasts: 18500,
      totalFishCaught: 27800,
      totalRelicQuantity: 420,
      totalGearDropped: 15,
    }).returning())[0];

    const [bRows, rodRows, baitRows, chestRows, talentRows, avatarRows] = await Promise.all([
      db.select().from(schema.biomes), db.select().from(schema.rods), db.select().from(schema.baits),
      db.select().from(schema.chests), db.select().from(schema.talents), db.select().from(schema.avatars),
    ]);
    await db.insert(schema.playerBiomes).values(bRows.map((b) => ({ playerId: player.id, biomeId: b.id, isUnlocked: b.orderIndex < 10 })));
    await db.insert(schema.playerRods).values(rodRows.map((r) => ({
      playerId: player.id, rodId: r.id, isOwned: ['novice_rod','strength_rod','intelligence_luck_rod','luck_rod'].includes(r.id),
      level: r.id === 'intelligence_luck_rod' ? 72 : 1,
    })));
    await db.insert(schema.playerBaits).values(baitRows.map((b) => ({ playerId: player.id, baitId: b.id, quantity: b.isUnlimited ? 0 : 120 })));
    await db.insert(schema.playerChests).values(chestRows.map((c) => ({ playerId: player.id, chestId: c.id, quantity: c.id === 'magic_gear_chest' ? 2 : 0 })));
    await db.insert(schema.playerTalents).values(talentRows.map((t) => ({ playerId: player.id, talentId: t.id, rank: 0 })));
    await db.insert(schema.playerAvatars).values(avatarRows.filter((a) => a.source === 'base').map((a) => ({ playerId: player.id, avatarId: a.id })));
    await db.insert(schema.playerArtifacts).values(LIGHTHOUSE_ARTIFACTS.slice(0, 3).map((a, i) => ({ playerId: player.id, artifactId: a.id, level: 3 + i })));
    await db.insert(schema.playerReincarnations).values({ playerId: player.id, round: 1, intelligencePoints: 5 });
    await db.insert(schema.globalSettings).values({ key: `reincarnation:${player.id}`, value: { totalPoints: 20, spentPoints: 0, freeResets: 1, ranks: { origin: 1 }, revision: 0 } });
    await db.insert(schema.playerStats).values({ playerId: player.id, loginDays: 1, lastLoginDate: chinaDate() });
    await db.insert(schema.dailyHarvest).values({ playerId: player.id, date: chinaDate(), casts: 0 });
    console.log(`test player seeded: ${testEmail}`);
  }
  await db.insert(schema.globalSettings).values([
    { key: 'weeklyTournamentActive', value: true },
    { key: 'arcaneSacrificeRotationVersion', value: 'arcane-sacrifice-rotation-v1' },
    { key: 'arcaneSacrificeTargetFormulaVersion', value: 'arcane-sacrifice-target-v2' },
    { key: 'site.branding', value: DEFAULT_SITE_BRANDING },
    { key: 'mail.smtp', value: DEFAULT_MAIL_CONFIG },
    { key: 'security.registration', value: DEFAULT_REGISTRATION_POLICY },
  ]);

  console.log('SEED COMPLETE');
}

seed().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
