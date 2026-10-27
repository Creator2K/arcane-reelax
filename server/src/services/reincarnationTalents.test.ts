import { describe, expect, it } from 'vitest';
import { reincarnationEffectiveLevel, reincarnationLevelPoints, reincarnationTalentCost, validateReincarnationRanks } from './reincarnationTalents.js';

describe('live reincarnation talent parity', () => {
  it('uses segmented level multipliers', () => {
    expect(reincarnationEffectiveLevel(15_000)).toBe(15_000);
    expect(reincarnationEffectiveLevel(16_500)).toBe(17_000);
    expect(reincarnationEffectiveLevel(17_500)).toBe(19_500);
    expect(reincarnationEffectiveLevel(18_500)).toBe(23_500);
    expect(reincarnationLevelPoints(16_500)).toBe(4);
    expect(reincarnationLevelPoints(17_500)).toBe(9);
  });

  it('charges the per-node live point costs', () => {
    expect(reincarnationTalentCost({ origin: 1, strength_1: 1 })).toBe(2);
    expect(reincarnationTalentCost({ origin: 1, strength_1: 2 })).toBe(4);
  });

  it('validates prerequisites only for selected nodes', () => {
    expect(validateReincarnationRanks({ origin: 1 })).toEqual({ origin: 1 });
    expect(validateReincarnationRanks({ origin: 1, strength_1: 1 })).toEqual({ origin: 1, strength_1: 1 });
    expect(() => validateReincarnationRanks({ origin: 1, strength_base_2: 1 })).toThrow();
  });
});
