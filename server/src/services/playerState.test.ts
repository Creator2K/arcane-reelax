import { describe, expect, it } from 'vitest';
import { experienceToNextLevel, levelMultiplier, xpForCast } from './playerState.js';
import { LEVEL_EXP_FORMULA } from '../constants.js';

describe('progression formulas', () => {
  it('computes increasing level requirements', () => {
    expect(experienceToNextLevel(1)).toBe(LEVEL_EXP_FORMULA(1));
    expect(experienceToNextLevel(100)).toBeGreaterThan(experienceToNextLevel(10));
    expect(experienceToNextLevel(1000)).toBeGreaterThan(experienceToNextLevel(999));
  });

  it('keeps the post-1000 level multiplier monotonic', () => {
    expect(levelMultiplier(1000)).toBe(1000);
    expect(levelMultiplier(1250)).toBeGreaterThan(levelMultiplier(1000));
    expect(levelMultiplier(10000)).toBeGreaterThan(levelMultiplier(9000));
  });

  it('returns positive cast xp for every rarity', () => {
    for (const rarity of ['common','uncommon','fine','rare','epic','legendary','mythic','exotic','arcane']) {
      const xp = xpForCast({ rarity, level: 1, masteryMultiplier: 1, weatherXpMultiplier: 1, intelligence: 0, guildMultiplier: 1, shopMultiplier: 1, activityMultiplier: 1 });
      expect(xp).toBeGreaterThan(0);
    }
  });
});
