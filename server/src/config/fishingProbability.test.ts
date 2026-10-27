import { describe, expect, it } from 'vitest';
import { categoryProbabilities, fishRarityProbabilities, maximumFishQuantity, rollFishQuantity } from '../config/fishingProbability.js';

describe('live fishing probability parity', () => {
  it('uses the live nine-rarity base distribution', () => {
    const probabilities = fishRarityProbabilities({ minRarityIndex: 0, maxRarityIndex: 8, selectedLuck: 0, baitLuck: 0 });
    const byRarity = Object.fromEntries(probabilities.map((item) => [item.rarity, item.probability]));
    expect(byRarity.common).toBeCloseTo(550_000_000 / 1_000_000_000, 10);
    expect(byRarity.uncommon).toBeCloseTo(0.28, 10);
    expect(byRarity.exotic).toBeCloseTo(0.000002, 10);
    expect(probabilities.reduce((sum, item) => sum + item.probability, 0)).toBeCloseTo(1, 12);
  });

  it('applies live luck sensitivity instead of a flat rarity boost', () => {
    const low = fishRarityProbabilities({ minRarityIndex: 0, maxRarityIndex: 8, selectedLuck: 500, baitLuck: 0 });
    const high = fishRarityProbabilities({ minRarityIndex: 0, maxRarityIndex: 8, selectedLuck: 7_262, baitLuck: 500 });
    const arcaneLow = low.find((item) => item.rarity === 'arcane')!.probability;
    const arcaneHigh = high.find((item) => item.rarity === 'arcane')!.probability;
    expect(arcaneHigh).toBeGreaterThan(arcaneLow * 5);
  });

  it('uses live main-drop category weights', () => {
    const probabilities = categoryProbabilities({ allowsRelic: true, allowsGear: true, allowsChest: true });
    const byCategory = Object.fromEntries(probabilities.map((item) => [item.rarity, item.probability]));
    expect(byCategory.fish).toBeCloseTo(0.98, 10);
    expect(byCategory.relic).toBeCloseTo(0.005, 10);
    expect(byCategory.gear).toBeCloseTo(0.01, 10);
    expect(byCategory.chest).toBeCloseTo(0.005, 10);
  });

  it('matches live strength quantity thresholds', () => {
    expect(maximumFishQuantity('common', 5_807)).toBe(14);
    expect(maximumFishQuantity('uncommon', 5_807)).toBe(12);
    expect(maximumFishQuantity('fine', 5_807)).toBe(10);
    expect(maximumFishQuantity('rare', 5_807)).toBe(7);
    expect(maximumFishQuantity('epic', 5_807)).toBe(6);
    expect(rollFishQuantity('common', 5_807)).toBeGreaterThanOrEqual(1);
    expect(rollFishQuantity('common', 5_807)).toBeLessThanOrEqual(14);
  });
});
