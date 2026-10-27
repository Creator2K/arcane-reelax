import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { and, eq } from 'drizzle-orm';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function grantPlayerBuff(
  tx: Tx,
  input: { playerId: string; source: string; buffType: string; bonusBasisPoints: number; durationSeconds: number },
) {
  const now = new Date();
  const rows = await tx.select().from(schema.playerBuffs).where(and(
    eq(schema.playerBuffs.playerId, input.playerId),
    eq(schema.playerBuffs.buffType, input.buffType),
    eq(schema.playerBuffs.bonusBasisPoints, input.bonusBasisPoints),
  )).orderBy(schema.playerBuffs.endsAt);
  const remainingMs = rows.reduce((total, row) => total + Math.max(0, row.endsAt.getTime() - now.getTime()), 0);
  const endsAt = new Date(now.getTime() + remainingMs + input.durationSeconds * 1000);
  if (rows.length) await tx.delete(schema.playerBuffs).where(and(
    eq(schema.playerBuffs.playerId, input.playerId),
    eq(schema.playerBuffs.buffType, input.buffType),
    eq(schema.playerBuffs.bonusBasisPoints, input.bonusBasisPoints),
  ));
  const inserted = (await tx.insert(schema.playerBuffs).values({
    playerId: input.playerId,
    source: input.source,
    buffType: input.buffType,
    bonusBasisPoints: input.bonusBasisPoints,
    startsAt: now,
    endsAt,
  }).returning())[0];
  return inserted;
}

export async function grantGlobalBuff(
  tx: Tx,
  input: { purchaserId: string; buffType: string; bonusBasisPoints: number; durationSeconds: number },
) {
  const now = new Date();
  const rows = await tx.select().from(schema.globalBuffs).where(and(
    eq(schema.globalBuffs.buffType, input.buffType),
    eq(schema.globalBuffs.bonusBasisPoints, input.bonusBasisPoints),
  )).orderBy(schema.globalBuffs.endsAt);
  const remainingMs = rows.reduce((total, row) => total + Math.max(0, row.endsAt.getTime() - now.getTime()), 0);
  const endsAt = new Date(now.getTime() + remainingMs + input.durationSeconds * 1000);
  if (rows.length) await tx.delete(schema.globalBuffs).where(and(
    eq(schema.globalBuffs.buffType, input.buffType),
    eq(schema.globalBuffs.bonusBasisPoints, input.bonusBasisPoints),
  ));
  const inserted = (await tx.insert(schema.globalBuffs).values({
    buffType: input.buffType,
    bonusBasisPoints: input.bonusBasisPoints,
    purchaserId: input.purchaserId,
    startsAt: now,
    endsAt,
  }).returning())[0];
  return inserted;
}

export function collapsePlayerBuffs<T extends { buffType: string; bonusBasisPoints: number; endsAt: Date | null }>(rows: T[]): T[] {
  const grouped = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.buffType}:${row.bonusBasisPoints}`;
    const existing = grouped.get(key);
    if (!existing || (row.endsAt?.getTime() ?? 0) > (existing.endsAt?.getTime() ?? 0)) grouped.set(key, row);
  }
  return [...grouped.values()];
}
