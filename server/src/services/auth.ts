import { FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { AppError } from '../util/errors.js';

export const SESSION_COOKIE = 'arcane-reelax-session';

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<typeof schema.players.$inferSelect> {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (!sessionId) throw new AppError('UNAUTHENTICATED', '请先登录后再继续。', 401);

  const session = (await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)))[0];
  if (!session || session.expiresAt < new Date()) throw new AppError('UNAUTHENTICATED', '登录状态已失效，请重新登录。', 401);

  const account = (await db.select().from(schema.accounts).where(eq(schema.accounts.id, session.accountId)))[0];
  if (!account) throw new AppError('UNAUTHENTICATED', '账号不存在。', 401);

  const player = (await db.select().from(schema.players).where(eq(schema.players.accountId, account.id)))[0];
  if (!player) throw new AppError('UNAUTHENTICATED', '尚未创建角色。', 401);

  // track daily login for login_days achievements
  const p = (n: number) => String(n).padStart(2, '0');
  const china = new Date(Date.now() + 8 * 3600 * 1000);
  const today = `${china.getUTCFullYear()}-${p(china.getUTCMonth() + 1)}-${p(china.getUTCDate())}`;
  const ps = (await db.select().from(schema.playerStats).where(eq(schema.playerStats.playerId, player.id)))[0];
  if (!ps) {
    await db.insert(schema.playerStats).values({ playerId: player.id, loginDays: 1, lastLoginDate: today }).onConflictDoNothing();
  } else if (ps.lastLoginDate !== today) {
    await db.update(schema.playerStats).set({ loginDays: ps.loginDays + 1, lastLoginDate: today }).where(eq(schema.playerStats.playerId, player.id));
  }

  // extend session
  const now = new Date();
  const maxAge = 30 * 24 * 60 * 60 * 1000;
  if (session.expiresAt.getTime() - now.getTime() < maxAge / 2) {
    await db.update(schema.sessions).set({ expiresAt: new Date(now.getTime() + maxAge) }).where(eq(schema.sessions.id, session.id));
  }
  reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(maxAge / 1000),
  });
  return player;
}

export async function requireAuthOrNull(req: FastifyRequest, reply: FastifyReply): Promise<typeof schema.players.$inferSelect | null> {
  try {
    return await requireAuth(req, reply);
  } catch {
    return null;
  }
}
