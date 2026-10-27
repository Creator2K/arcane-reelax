import { describe, expect, it } from 'vitest';
import { ONLINE_GEAR_TEMPLATES, gearStatBudget, gearStatsAtLevel, gearUpgradeCost, gearSellValue, qualityStarsFor, rollGearStats } from './gearGeneration.js';

describe('live gear generation parity', () => {
  it('uses the eight live equipment templates', () => {
    expect(ONLINE_GEAR_TEMPLATES.map((item) => item.id)).toEqual([
      'river_circlet', 'angler_coat', 'current_leggings', 'stonewater_boots',
      'linekeeper_gloves', 'tide_ring', 'moon_amulet', 'bobber_charm',
    ]);
  });

  it('matches live quality-star bands', () => {
    expect([qualityStarsFor(0), qualityStarsFor(25), qualityStarsFor(26), qualityStarsFor(50)]).toEqual([1, 1, 2, 2]);
    expect([qualityStarsFor(51), qualityStarsFor(80), qualityStarsFor(81), qualityStarsFor(99), qualityStarsFor(100)]).toEqual([3, 3, 4, 4, 5]);
  });

  it('matches live stat budgets', () => {
    expect(gearStatBudget(0, 8)).toBe(9);
    expect(gearStatBudget(1, 50)).toBe(68);
    expect(gearStatBudget(2, 78)).toBe(145);
    expect(gearStatBudget(3, 90)).toBe(237);
    expect(gearStatBudget(4, 100)).toBe(341);
    expect(gearStatBudget(5, 56)).toBe(274);
    expect(gearStatBudget(6, 55)).toBe(330);
    expect(gearStatBudget(7, 98)).toBe(721);
    expect(gearStatBudget(8, 97)).toBe(918);
  });

  it('conserves the rolled stat budget', () => {
    for (let quality = 0; quality <= 100; quality += 1) {
      const stats = rollGearStats('angler_coat', quality, 'exotic');
      expect(Object.values(stats).reduce((sum, value) => sum + value, 0)).toBe(gearStatBudget(7, quality));
    }
  });

  it('matches live upgrade and sale formulas', () => {
    expect(gearStatsAtLevel({ strength: 385, intelligence: 208, luck: 299, endurance: 26 }, 6)).toEqual({ strength: 916, intelligence: 495, luck: 711, endurance: 61 });
    expect(gearUpgradeCost('exotic', 0)).toBe(1_225_000);
    expect(gearSellValue('common')).toBe(7_500);
    expect(gearSellValue('arcane')).toBe(1_600_000);
  });
});
