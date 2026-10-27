import { REINCARNATION_TALENTS } from '../config/reincarnationTalents.js';
import { AppError } from '../util/errors.js';

type TalentConfig = typeof REINCARNATION_TALENTS;
type TalentNode = TalentConfig['nodes'][number];
type Ranks = Record<string, number>;

const nodes = REINCARNATION_TALENTS.nodes as readonly TalentNode[];
const nodeMap = new Map(nodes.map((node) => [node.id, node]));

export function normalizeReincarnationRanks(input: Record<string, unknown>): Ranks {
  const ranks: Ranks = { origin: 1 };
  for (const node of nodes) {
    const value = Number(input[node.id] ?? 0);
    const rank = Number.isFinite(value) ? Math.max(0, Math.min(node.maxLevel, Math.floor(value))) : 0;
    if (rank > 0) ranks[node.id] = rank;
  }
  ranks.origin = 1;
  return ranks;
}

export function validateReincarnationRanks(input: Record<string, unknown>): Ranks {
  const ranks = normalizeReincarnationRanks(input);
  for (const node of nodes) {
    const rank = ranks[node.id] ?? 0;
    if (rank > node.maxLevel) throw new AppError('REINCARNATION_TALENT_INVALID', `${node.name}等级超出上限。`);
    if (rank <= 0) continue;
    for (const prerequisite of node.prerequisites) {
      if ((ranks[prerequisite.id] ?? 0) < prerequisite.level) {
        throw new AppError('REINCARNATION_PREREQUISITE_REQUIRED', `需要先满足${node.name}的前置天赋。`);
      }
    }
  }
  return ranks;
}

export function reincarnationTalentCost(input: Record<string, unknown>): number {
  const ranks = normalizeReincarnationRanks(input);
  let total = 0;
  for (const node of nodes) {
    const rank = ranks[node.id] ?? 0;
    for (let index = 0; index < Math.min(rank, node.levels.length); index += 1) {
      total += Number(node.levels[index].cost ?? 0);
    }
  }
  return total;
}

export function reincarnationTalentEffects(input: Record<string, unknown>) {
  const ranks = normalizeReincarnationRanks(input);
  const effects: Record<string, number> = {};
  for (const node of nodes) {
    const rank = ranks[node.id] ?? 0;
    if (rank <= 0) continue;
    const level = node.levels[Math.min(rank, node.levels.length) - 1];
    if (!level) continue;
    for (const [key, value] of Object.entries(level.effects)) {
      if (typeof value !== 'number') continue;
      const combine = (REINCARNATION_TALENTS.effects as Record<string, { combine?: string }>)[key]?.combine;
      effects[key] = combine === 'max' ? Math.max(effects[key] ?? 0, value) : (effects[key] ?? 0) + value;
    }
  }
  return effects;
}

export function reincarnationEffectiveLevel(level: number): number {
  const parameters = REINCARNATION_TALENTS.parameters;
  const actual = Math.min(parameters.baseLevelCap, Math.max(0, Math.floor(level)));
  const bands = parameters.levelRewardBands;
  let effective = Math.min(actual, bands[0]?.startLevel ?? actual);
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const nextStart = bands[index + 1]?.startLevel ?? parameters.baseLevelCap;
    if (actual <= band.startLevel) break;
    effective += (Math.min(actual, nextStart) - band.startLevel) * band.multiplier;
  }
  return effective;
}

export function reincarnationLevelPoints(level: number): number {
  const parameters = REINCARNATION_TALENTS.parameters;
  if (level < parameters.bonusStartLevel) return 0;
  const effectiveLevel = reincarnationEffectiveLevel(level);
  return Math.max(0, Math.floor((effectiveLevel - parameters.bonusStartLevel) / parameters.levelsPerPoint));
}

export function reincarnationConfigVersion(): number {
  return REINCARNATION_TALENTS.version;
}
