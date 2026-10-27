import { RARITY_ORDER } from '../constants.js';

export type GearStat = 'strength' | 'intelligence' | 'luck' | 'endurance';

export type GearTemplateConfig = {
  id: string;
  name: string;
  slot: string;
  allocation: Record<GearStat, number>;
  omission: Record<GearStat, number>;
};

export const ONLINE_GEAR_TEMPLATES: GearTemplateConfig[] = [
  { id: 'river_circlet', name: '潮纹额冠', slot: 'head', allocation: { strength: 0.263, intelligence: 0.224, luck: 0.289, endurance: 0.224 }, omission: { strength: 0.28, intelligence: 0.22, luck: 0.20, endurance: 0.30 } },
  { id: 'angler_coat', name: '渡水长衣', slot: 'chest', allocation: { strength: 0.257, intelligence: 0.320, luck: 0.251, endurance: 0.171 }, omission: { strength: 0.25, intelligence: 0.15, luck: 0.225, endurance: 0.375 } },
  { id: 'current_leggings', name: '顺流绑腿', slot: 'legs', allocation: { strength: 0.233, intelligence: 0.238, luck: 0.339, endurance: 0.191 }, omission: { strength: 0.28, intelligence: 0.22, luck: 0.156, endurance: 0.344 } },
  { id: 'stonewater_boots', name: '踏石靴', slot: 'boots', allocation: { strength: 0.234, intelligence: 0.266, luck: 0.294, endurance: 0.206 }, omission: { strength: 0.333, intelligence: 0.179, luck: 0.256, endurance: 0.231 } },
  { id: 'linekeeper_gloves', name: '守线手套', slot: 'gloves', allocation: { strength: 0.201, intelligence: 0.309, luck: 0.333, endurance: 0.158 }, omission: { strength: 0.318, intelligence: 0.068, luck: 0.159, endurance: 0.455 } },
  { id: 'tide_ring', name: '潮声戒指', slot: 'ring', allocation: { strength: 0.201, intelligence: 0.276, luck: 0.228, endurance: 0.294 }, omission: { strength: 0.217, intelligence: 0.217, luck: 0.304, endurance: 0.261 } },
  { id: 'moon_amulet', name: '月汐护符', slot: 'amulet', allocation: { strength: 0.300, intelligence: 0.272, luck: 0.252, endurance: 0.176 }, omission: { strength: 0.118, intelligence: 0.275, luck: 0.216, endurance: 0.392 } },
  { id: 'bobber_charm', name: '浮标符咒', slot: 'charm', allocation: { strength: 0.248, intelligence: 0.259, luck: 0.271, endurance: 0.222 }, omission: { strength: 0.207, intelligence: 0.207, luck: 0.207, endurance: 0.379 } },
];

const GEAR_STATS: GearStat[] = ['strength', 'intelligence', 'luck', 'endurance'];

// Exact item-level totals recovered from live v0.26.1 inventory and market samples.
const STAT_BUDGET_BASE = [3.75, 6.25, 8.75, 12.5, 16.25, 22.5, 27.5, 35, 45];
const STAT_BUDGET_STEP = [0.75, 1.25, 1.75, 2.5, 3.25, 4.5, 5.5, 7, 9];

// Live effectiveStats use a fixed level multiplier and floor each stat independently.
const UPGRADE_MULTIPLIERS = [1, 1.17, 1.35, 1.56, 1.8, 2.07, 2.38, 2.73, 3.14, 3.65, 4.23];

const SELL_VALUES: Record<string, number> = {
  common: 7_500,
  uncommon: 15_000,
  fine: 25_000,
  rare: 50_000,
  epic: 100_000,
  legendary: 200_000,
  mythic: 400_000,
  exotic: 800_000,
  arcane: 1_600_000,
};

const UPGRADE_BASE_COST: Record<string, number> = {
  common: 13_125,
  uncommon: 26_250,
  fine: 43_750,
  rare: 87_500,
  epic: 175_000,
  legendary: 350_000,
  mythic: 612_500,
  exotic: 1_225_000,
  arcane: 2_450_000,
};

export function qualityStarsFor(quality: number): number {
  if (quality >= 100) return 5;
  if (quality >= 81) return 4;
  if (quality >= 51) return 3;
  if (quality >= 26) return 2;
  return 1;
}

export function gearStatBudget(rarityIndex: number, quality: number): number {
  const index = Math.max(0, Math.min(STAT_BUDGET_BASE.length - 1, rarityIndex));
  return Math.floor(STAT_BUDGET_BASE[index] + Math.max(0, Math.min(100, quality)) * STAT_BUDGET_STEP[index]);
}

export function gearStatCount(rarity: string): number {
  const index = RARITY_ORDER.indexOf(rarity as any);
  if (index <= 0) return 1;
  if (index <= 2) return 2;
  if (index === 3) return Math.random() < 0.45 ? 3 : 2;
  if (index >= 8) return 4;
  return 3;
}

function weightedPick<T>(items: T[], weights: number[], used: Set<T>): T {
  const available = items.filter((item) => !used.has(item));
  const total = available.reduce((sum, item) => sum + Math.max(0.0001, weights[items.indexOf(item)]), 0);
  let roll = Math.random() * total;
  for (const item of available) {
    roll -= Math.max(0.0001, weights[items.indexOf(item)]);
    if (roll <= 0) return item;
  }
  return available[available.length - 1];
}

export function rollGearStats(templateId: string, quality: number, rarity: string): Record<GearStat, number> {
  const template = ONLINE_GEAR_TEMPLATES.find((item) => item.id === templateId) ?? ONLINE_GEAR_TEMPLATES[0];
  const templateIndex = RARITY_ORDER.indexOf(rarity as any);
  const count = gearStatCount(rarity);
  const selected: GearStat[] = [];
  while (selected.length < count) {
    const pick = weightedPick(GEAR_STATS, GEAR_STATS.map((stat) => template.omission[stat]), new Set(selected));
    if (!pick) break;
    selected.push(pick);
  }

  const total = gearStatBudget(templateIndex, quality);
  const randomWeights = selected.map((stat) => template.allocation[stat] * (0.2 + Math.random() * 1.8));
  const weightTotal = randomWeights.reduce((sum, value) => sum + value, 0) || 1;
  const remaining = Math.max(0, total - selected.length);
  const exact = randomWeights.map((weight) => 1 + (remaining * weight) / weightTotal);
  const allocated = exact.map(Math.floor);
  let remainder = total - allocated.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - allocated[index] }))
    .sort((left, right) => right.fraction - left.fraction);
  for (let index = 0; index < remainder; index += 1) allocated[order[index % order.length].index] += 1;

  const stats: Record<GearStat, number> = { strength: 0, intelligence: 0, luck: 0, endurance: 0 };
  selected.forEach((stat, index) => { stats[stat] = allocated[index]; });
  return stats;
}

export function gearUpgradeMultiplier(level: number): number {
  return UPGRADE_MULTIPLIERS[Math.max(0, Math.min(10, Math.floor(level)))] ?? UPGRADE_MULTIPLIERS[0];
}

export function gearStatsAtLevel(baseStats: Record<string, number>, level: number, limitBreakPercent = 0): Record<string, number> {
  const multiplier = gearUpgradeMultiplier(level) * (1 + Math.max(0, Math.min(20, limitBreakPercent)) / 100);
  const stats: Record<string, number> = {};
  for (const stat of GEAR_STATS) stats[stat] = Math.floor((Number(baseStats?.[stat]) || 0) * multiplier);
  return stats;
}

export function gearSellValue(rarity: string): number {
  return SELL_VALUES[rarity] ?? 0;
}

export function gearUpgradeCost(rarity: string, level: number): number {
  if (level < 0 || level >= 10) return 0;
  return Math.floor((UPGRADE_BASE_COST[rarity] ?? 0) * Math.pow(1.75, level));
}

export function gearSeedStatRange(template: GearTemplateConfig): Record<GearStat, [number, number]> {
  return Object.fromEntries(GEAR_STATS.map((stat) => [stat, [Math.round(template.allocation[stat] * 100), Math.round(template.allocation[stat] * 100)]])) as Record<GearStat, [number, number]>;
}
