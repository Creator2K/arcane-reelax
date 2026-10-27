import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { RARITY_XP_MULTIPLIERS, LEVEL_EXP_FORMULA } from '../constants.js';

export type StatBreakdown = {
  base: Record<string, number>;
  rod: Record<string, number>;
  gear: Record<string, number>;
  medals: Record<string, number>;
  personalTrophyBonuses: Record<string, number>;
  guild: Record<string, number>;
  guildTrophies: Record<string, number>;
  artifacts: Record<string, number>;
  artifactPercentage: Record<string, number>;
  reincarnation: Record<string, number>;
  total: Record<string, number>;
};

export interface FullPlayerContext {
  player: typeof schema.players.$inferSelect;
  stats: StatBreakdown;
  currentBiome: typeof schema.biomes.$inferSelect | null;
  guild: (typeof schema.guilds.$inferSelect & { guildBoost: (typeof schema.guildBoosts.$inferSelect) | null }) | null;
  guildTotems: (typeof schema.guildTotems.$inferSelect)[];
  playerBuffs: (typeof schema.playerBuffs.$inferSelect)[];
  globalBuffs: (typeof schema.globalBuffs.$inferSelect)[];
  activeParty: (typeof schema.partyBoats.$inferSelect) & { effectiveCrewCount: number };
  rodLevel: number;
  rodStats: Record<string, number>;
  talents: Record<string, number>;
  trophyIds: string[];
  weeklyMedalIds: string[];
  membership: (typeof schema.guildMembers.$inferSelect) | null;
  artifacts: Array<typeof schema.playerArtifacts.$inferSelect & { definition: typeof schema.lighthouseArtifacts.$inferSelect }>;
  reincarnation: typeof schema.playerReincarnations.$inferSelect;
}

export async function loadPlayerContext(playerId: string): Promise<FullPlayerContext> {
  const player = (await db.select().from(schema.players).where(eq(schema.players.id, playerId)))[0];
  if (!player) throw new Error('player not found');

  const playerRods = await db.select().from(schema.playerRods).where(eq(schema.playerRods.playerId, playerId));
  const gear = await db.select().from(schema.gearItems).where(eq(schema.gearItems.ownerId, playerId));
  const playerBiomes = await db.select().from(schema.playerBiomes).where(eq(schema.playerBiomes.playerId, playerId));
  const membershipRows = await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, playerId));
  const buffs = await db.select().from(schema.playerBuffs).where(sql`${schema.playerBuffs.playerId} = ${playerId} AND ${schema.playerBuffs.endsAt} > now()`);
  const globalBuffs = await db.select().from(schema.globalBuffs).where(sql`${schema.globalBuffs.endsAt} > now()`);
  const partyMemberRows = await db.select().from(schema.partyBoatMembers).innerJoin(schema.partyBoats, eq(schema.partyBoatMembers.boatId, schema.partyBoats.id)).where(eq(schema.partyBoatMembers.playerId, playerId));
  const talentRows = await db.select().from(schema.playerTalents).where(eq(schema.playerTalents.playerId, playerId));
  const trophyRows = await db.select().from(schema.playerTrophies).where(eq(schema.playerTrophies.playerId, playerId));
  const medalRows = await db.select().from(schema.playerWeeklyMedals).where(eq(schema.playerWeeklyMedals.playerId, playerId));
  const artifactRows = await db.select().from(schema.playerArtifacts).where(eq(schema.playerArtifacts.playerId, playerId));
  const artifactDefs = await db.select().from(schema.lighthouseArtifacts).where(eq(schema.lighthouseArtifacts.isActive, true));
  const reincarnationRow = await db.select().from(schema.playerReincarnations).where(eq(schema.playerReincarnations.playerId, playerId));

  const currentBiome = (await db.select().from(schema.biomes).where(eq(schema.biomes.id, player.currentBiomeId)))[0] ?? null;

  let guild = null;
  let guildTotemsRows: (typeof schema.guildTotems.$inferSelect)[] = [];
  const membership = membershipRows[0] ?? null;
  if (membership) {
    const g = (await db.select().from(schema.guilds).where(eq(schema.guilds.id, membership.guildId)))[0];
    if (g) {
      const [ts, gbRows] = await Promise.all([
        db.select().from(schema.guildTotems).where(eq(schema.guildTotems.guildId, g.id)),
        db.select().from(schema.guildBoosts).where(eq(schema.guildBoosts.guildId, g.id)),
      ]);
      guildTotemsRows = ts;
      const guildBoost = gbRows.find((b) => b.isActive && b.endsAt && b.endsAt > new Date()) ?? null;
      guild = { ...g, guildBoost };
    }
  }

  let activeParty: (typeof schema.partyBoats.$inferSelect) & { effectiveCrewCount: number } = null as never;
  if (partyMemberRows[0]) {
    const boat = partyMemberRows[0].party_boats;
    const countRow = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.partyBoatMembers)
      .where(eq(schema.partyBoatMembers.boatId, boat.id));
    activeParty = { ...boat, effectiveCrewCount: Math.max(1, Number(countRow[0]?.count ?? 1)) };
  }

  // rod stats
  const rodsContent = await db.select().from(schema.rods);
  const equippedRod = playerRods.find((r) => r.rodId === player.equippedRodId && r.isOwned) ?? null;
  const rodDef = equippedRod ? rodsContent.find((r) => r.id === equippedRod.rodId) : null;
  const rodStats: Record<string, number> = { strength: 0, intelligence: 0, luck: 0, endurance: 0 };
  if (rodDef && equippedRod) {
    for (const [k, v] of Object.entries(rodDef.statPerLevel ?? {})) {
      rodStats[k] = (v as number) * Math.max(0, equippedRod.level - 1);
    }
  }

  const definitionMap = new Map(artifactDefs.map((a) => [a.id, a]));
  const ownedArtifacts = artifactRows.map((a) => ({ ...a, definition: definitionMap.get(a.artifactId)! })).filter((a) => a.definition);
  const reincarnation = reincarnationRow[0] ?? {
    playerId, round: 0, strengthPoints: 0, intelligencePoints: 0, luckPoints: 0, endurancePoints: 0, updatedAt: new Date(),
  };
  const stats = computeStats(player, rodStats, gear, buffs, ownedArtifacts, reincarnation);

  const talentRanks: Record<string, number> = {};
  for (const t of talentRows) talentRanks[t.talentId] = t.rank;

  return {
    player,
    stats,
    currentBiome,
    guild,
    guildTotems: guildTotemsRows,
    playerBuffs: buffs,
    globalBuffs,
    activeParty,
    rodLevel: equippedRod?.level ?? 1,
    rodStats,
    talents: talentRanks,
    trophyIds: trophyRows.map((t) => t.trophyId),
    weeklyMedalIds: medalRows.map((m) => m.medalId),
    membership,
    artifacts: ownedArtifacts,
    reincarnation,
  };
}

function computeStats(
  player: typeof schema.players.$inferSelect,
  rodStats: Record<string, number>,
  gear: (typeof schema.gearItems.$inferSelect)[],
  buffs: (typeof schema.playerBuffs.$inferSelect)[],
  artifacts: Array<typeof schema.playerArtifacts.$inferSelect & { definition: typeof schema.lighthouseArtifacts.$inferSelect }>,
  reincarnation: typeof schema.playerReincarnations.$inferSelect,
): StatBreakdown {
  const base = {
    strength: player.baseStrength,
    intelligence: player.baseIntelligence,
    luck: player.baseLuck,
    endurance: player.baseEndurance,
  };
  const rod = { strength: 0, intelligence: 0, luck: 0, endurance: 0 };
  for (const k of ['strength', 'intelligence', 'luck', 'endurance'] as const) rod[k] = rodStats[k] ?? 0;

  const gearStats = { strength: 0, intelligence: 0, luck: 0, endurance: 0 };
  for (const g of gear.filter((x) => x.isEquipped)) {
    const s = g.baseStats ?? {};
    for (const k of ['strength', 'intelligence', 'luck', 'endurance'] as const) {
      const upgradeBonus = g.upgradeLevel > 0 ? Math.round((s[k] ?? 0) * g.upgradeLevel * 0.1) : 0;
      gearStats[k] += (s[k] ?? 0) + upgradeBonus;
    }
  }

  const medals = { strength: 0, intelligence: 0, luck: 0, endurance: 0 };
  const personalTrophyBonuses = { personalTournament: 0, weeklyTournament: 0, arcaneSacrifice: 0 };
  const guildStats = { strength: 0, intelligence: 0, luck: 0, endurance: 0 };
  const guildTrophies = { strength: 0, intelligence: 0, luck: 0, endurance: 0 };
  const artifactStats = { strength: 0, intelligence: 0, luck: 0, endurance: 0 };
  const artifactPercentage = { strength: 0, intelligence: 0, luck: 0, endurance: 0 };
  const reincarnationStats = {
    strength: reincarnation.strengthPoints, intelligence: reincarnation.intelligencePoints,
    luck: reincarnation.luckPoints, endurance: reincarnation.endurancePoints,
  };
  for (const item of artifacts) {
    const amount = item.definition.baseBonus * item.level;
    if (item.definition.statType === 'all') {
      for (const key of ['strength','intelligence','luck','endurance'] as const) artifactStats[key] += amount;
    } else if (item.definition.statType in artifactStats) {
      artifactStats[item.definition.statType as keyof typeof artifactStats] += amount;
    } else if (item.definition.statType.endsWith('_pct')) {
      const key = item.definition.statType.replace('_pct', '') as keyof typeof artifactPercentage;
      if (key in artifactPercentage) artifactPercentage[key] += Number((item.level * 0.05).toFixed(2));
    }
  }

  const applyBuffs = (stat: string, raw: number): number => {
    let mult = 1;
    for (const b of buffs) {
      if (b.buffType === stat) mult += b.bonusBasisPoints / 10000;
    }
    return Math.round(raw * mult);
  };

  const total = {
    strength: applyBuffs('strength', base.strength + rod.strength + gearStats.strength + artifactStats.strength + reincarnationStats.strength),
    intelligence: applyBuffs('intelligence', base.intelligence + rod.intelligence + gearStats.intelligence + artifactStats.intelligence + reincarnationStats.intelligence),
    luck: applyBuffs('luck', base.luck + rod.luck + gearStats.luck + artifactStats.luck + reincarnationStats.luck),
    endurance: applyBuffs('endurance', base.endurance + rod.endurance + gearStats.endurance + artifactStats.endurance + reincarnationStats.endurance),
  };

  return { base, rod, gear: gearStats, medals, personalTrophyBonuses, guild: guildStats, guildTrophies, artifacts: artifactStats, artifactPercentage, reincarnation: reincarnationStats, total };
}

export function experienceToNextLevel(level: number): number {
  return LEVEL_EXP_FORMULA(level);
}

export function levelMultiplier(level: number): number {
  if (level <= 1000) return level;
  return 1000 + (level - 1000) / 2.5;
}

export function xpForCast(args: {
  rarity: string;
  level: number;
  masteryMultiplier: number;
  weatherXpMultiplier: number;
  intelligence: number;
  guildMultiplier: number;
  shopMultiplier: number;
  activityMultiplier: number;
}): number {
  const { rarity, level, masteryMultiplier, weatherXpMultiplier, intelligence, guildMultiplier, shopMultiplier, activityMultiplier } = args;
  const base = 6.5 + Math.random() * 0.5;
  const rarityMult = RARITY_XP_MULTIPLIERS[rarity] ?? 1.05;
  const intelMult = Math.min(6, 1 + intelligence / 100);
  return Math.floor(base * levelMultiplier(level) * rarityMult * masteryMultiplier * weatherXpMultiplier * intelMult * guildMultiplier * shopMultiplier * activityMultiplier);
}
