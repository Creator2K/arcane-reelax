import { RARITY_ORDER } from '../constants.js';

export const FISHING_CATEGORY_WEIGHTS = { fish: 980_000, relic: 5_000, gear: 10_000, chest: 5_000 } as const;

export const FISH_RARITY_WEIGHTS: Record<string, { baseWeight: number; luckSensitivity: number }> = {
  common: { baseWeight: 550_000_000, luckSensitivity: 0 },
  uncommon: { baseWeight: 280_000_000, luckSensitivity: 0.02 },
  fine: { baseWeight: 120_000_000, luckSensitivity: 0.05 },
  rare: { baseWeight: 40_000_000, luckSensitivity: 0.1 },
  epic: { baseWeight: 9_881_800, luckSensitivity: 0.25 },
  legendary: { baseWeight: 100_000, luckSensitivity: 1.7 },
  mythic: { baseWeight: 16_000, luckSensitivity: 1.7 },
  exotic: { baseWeight: 2_000, luckSensitivity: 1.5 },
  arcane: { baseWeight: 200, luckSensitivity: 2 },
};

export const FISH_QUANTITY_THRESHOLDS: Record<string, number[]> = {
  common: [25, 100, 200, 350, 550, 800, 1100, 1400, 1700, 2200, 2800, 3500, 4500, 6000, 8000, 11000, 15000, 20000, 27000, 36000, 48000],
  uncommon: [50, 200, 400, 650, 900, 1250, 1700, 2300, 3000, 4000, 5500, 7500, 10000, 14000, 19000, 26000, 35000, 47000],
  fine: [300, 600, 900, 1300, 1700, 2300, 3100, 4200, 5700, 7800, 10500, 14000, 19000, 26000, 35000, 47000],
  rare: [600, 1100, 1700, 2400, 3300, 4500, 6200, 8500, 11500, 15500, 21000, 28000, 38000, 50000],
  epic: [900, 1700, 2600, 3800, 5400, 7600, 10500, 14500, 20000, 27500, 38000, 50000],
  legendary: [],
  mythic: [],
  exotic: [],
  arcane: [],
};

const PITY_STRENGTH_BONUS = {
  startsAt: 15_000,
  capsAt: 50_000,
  step: 5_000,
  bonuses: { mythic: 0.05, exotic: 0.1, arcane: 0.25 } as Record<string, number>,
};

function luckSensitivityBonuses(luck: number): Record<string, number> {
  const steps = (Math.min(PITY_STRENGTH_BONUS.capsAt, Math.max(PITY_STRENGTH_BONUS.startsAt, luck)) - PITY_STRENGTH_BONUS.startsAt) / PITY_STRENGTH_BONUS.step;
  if (luck < PITY_STRENGTH_BONUS.startsAt) return {};
  return Object.fromEntries(Object.entries(PITY_STRENGTH_BONUS.bonuses).map(([rarity, bonus]) => [rarity, bonus * steps]));
}

function normalizeWeights(entries: Array<{ rarity: string; weight: number }>) {
  const total = entries.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  return entries.map((item) => ({ rarity: item.rarity, probability: total > 0 ? Math.max(0, item.weight) / total : 0 }));
}

export function fishRarityProbabilities(args: {
  minRarityIndex: number;
  maxRarityIndex: number;
  selectedLuck: number;
  baitLuck: number;
  baitMultipliers?: Record<string, number>;
  weatherMultipliers?: Record<string, number>;
}) {
  const minIndex = Math.max(0, args.minRarityIndex);
  const maxIndex = Math.min(RARITY_ORDER.length - 1, args.maxRarityIndex);
  const effectiveLuck = Math.max(0, args.selectedLuck) + Math.max(0, args.baitLuck);
  const sensitivityBonuses = luckSensitivityBonuses(Math.max(0, args.selectedLuck));
  const entries = RARITY_ORDER.slice(minIndex, maxIndex + 1).map((rarity) => {
    const definition = FISH_RARITY_WEIGHTS[rarity];
    const baitMultiplier = args.baitMultipliers?.[rarity] ?? 1;
    const weatherMultiplier = args.weatherMultipliers?.[rarity] ?? 1;
    const combinedMultiplier = Math.max(0, baitMultiplier + weatherMultiplier - 1);
    const sensitivity = definition.luckSensitivity + (sensitivityBonuses[rarity] ?? 0);
    return { rarity, weight: definition.baseWeight * (1 + (effectiveLuck / 100) * sensitivity) * combinedMultiplier };
  });
  return normalizeWeights(entries);
}

export function rollFishingRarity(args: Parameters<typeof fishRarityProbabilities>[0]): string {
  const probabilities = fishRarityProbabilities(args);
  let roll = Math.random();
  for (const item of probabilities) {
    roll -= item.probability;
    if (roll <= 0) return item.rarity;
  }
  return probabilities.at(-1)?.rarity ?? 'common';
}

export function categoryProbabilities(args: {
  allowsRelic: boolean;
  allowsGear: boolean;
  allowsChest: boolean;
  gearRodMultiplier?: number;
  chestRodMultiplier?: number;
  weatherGearMultiplier?: number;
  weatherRelicMultiplier?: number;
}) {
  const entries = [
    { category: 'fish', weight: FISHING_CATEGORY_WEIGHTS.fish },
    { category: 'relic', weight: args.allowsRelic ? FISHING_CATEGORY_WEIGHTS.relic * (args.weatherRelicMultiplier ?? 1) : 0 },
    { category: 'gear', weight: args.allowsGear ? FISHING_CATEGORY_WEIGHTS.gear * (args.gearRodMultiplier ?? 1) * (args.weatherGearMultiplier ?? 1) : 0 },
    { category: 'chest', weight: args.allowsChest ? FISHING_CATEGORY_WEIGHTS.chest * (args.chestRodMultiplier ?? 1) : 0 },
  ];
  return normalizeWeights(entries.map((item) => ({ rarity: item.category, weight: item.weight })));
}

export function rollFishingCategory(args: Parameters<typeof categoryProbabilities>[0]): 'fish' | 'relic' | 'gear' | 'chest' {
  const probabilities = categoryProbabilities(args);
  let roll = Math.random();
  for (const item of probabilities) {
    roll -= item.probability;
    if (roll <= 0) return item.rarity as 'fish' | 'relic' | 'gear' | 'chest';
  }
  return 'fish';
}

export function maximumFishQuantity(rarity: string, strength: number): number {
  const thresholds = FISH_QUANTITY_THRESHOLDS[rarity] ?? [];
  return 1 + thresholds.filter((threshold) => strength >= threshold).length;
}

export function rollFishQuantity(rarity: string, strength: number): number {
  return 1 + Math.floor(Math.random() * maximumFishQuantity(rarity, strength));
}
