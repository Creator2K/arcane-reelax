import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { eq, and, sql, desc, asc } from 'drizzle-orm';
import { AppError } from '../util/errors.js';
import { sendMail } from '../services/mail.js';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';

// Admin auth: HMAC-signed, expiring session cookie. Set credentials in .env.
const ADMIN_COOKIE = 'arcane-reelax-admin';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || 'replace-this-admin-session-secret';
const SESSION_MS = 12 * 60 * 60 * 1000;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function sign(value: string): string {
  return createHmac('sha256', ADMIN_SESSION_SECRET).update(value).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function adminToken(username: string): string {
  const payload = Buffer.from(JSON.stringify({ username, exp: Date.now() + SESSION_MS })).toString('base64url');
  return payload + '.' + sign(payload);
}

function verifyAdminToken(token: string): { username: string; exp: number } | null {
  const at = token.indexOf('.');
  if (at < 1) return null;
  const payload = token.slice(0, at);
  const signature = token.slice(at + 1);
  if (!safeEqual(signature, sign(payload))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { username: string; exp: number };
    if (parsed.username !== ADMIN_USERNAME || !Number.isFinite(parsed.exp) || parsed.exp <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function requireAdmin(req: any, reply: any) {
  const token = req.cookies?.[ADMIN_COOKIE];
  if (!token || !verifyAdminToken(token)) {
    throw new AppError('ADMIN_UNAUTHENTICATED', '请先登录管理后台。', 401);
  }
  return true;
}

async function audit(actor: string, action: string, targetType: string, targetId: string | null, details: Record<string, unknown> = {}) {
  await db.insert(schema.adminAuditLogs).values({ actor, action, targetType, targetId, details });
}

function loginAttemptKey(req: any, username: string) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown') + ':' + username;
}

export async function registerAdminRoutes(app: FastifyInstance) {
  app.post('/api/admin/login', async (req, reply) => {
    const body = z.object({ username: z.string().max(64), password: z.string().max(256) }).parse(req.body as any);
    if (!ADMIN_PASSWORD) {
      throw new AppError('ADMIN_NOT_CONFIGURED', '尚未配置管理员密码，请设置 ADMIN_PASSWORD 后重启服务。', 503);
    }
    const key = loginAttemptKey(req, body.username);
    const current = loginAttempts.get(key);
    if (current && current.resetAt > Date.now() && current.count >= 5) {
      throw new AppError('ADMIN_RATE_LIMITED', '登录尝试过于频繁，请 10 分钟后再试。', 429);
    }
    const ok = body.username === ADMIN_USERNAME && safeEqual(body.password, ADMIN_PASSWORD);
    if (!ok) {
      if (!current || current.resetAt <= Date.now()) loginAttempts.set(key, { count: 1, resetAt: Date.now() + 10 * 60_000 });
      else current.count++;
      await audit(body.username.slice(0, 64), 'admin.login_failed', 'admin_session', null, { ip: req.ip });
      throw new AppError('ADMIN_INVALID_CREDENTIALS', '管理员账号或密码不正确。');
    }
    loginAttempts.delete(key);
    reply.setCookie(ADMIN_COOKIE, adminToken(body.username), {
      httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: Math.floor(SESSION_MS / 1000),
    });
    await audit(body.username, 'admin.login', 'admin_session', null, { ip: req.ip });
    return { success: true };
  });

  app.post('/api/admin/logout', async (req, reply) => {
    reply.clearCookie(ADMIN_COOKIE, { path: '/' });
    return { success: true };
  });

  app.get('/api/admin/me', async (req, reply) => {
    await requireAdmin(req, reply);
    return { username: ADMIN_USERNAME };
  });

  // ============ overview ============
  app.get('/api/admin/overview', async (req, reply) => {
    await requireAdmin(req, reply);
    const [players, accounts, runs, orders, guilds, boats, rounds, today] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(schema.players),
      db.select({ count: sql<number>`count(*)::int` }).from(schema.accounts),
      db.select({ count: sql<number>`count(*)::int` }).from(schema.fishingRuns).where(eq(schema.fishingRuns.status, 'running')),
      db.select({ count: sql<number>`count(*)::int` }).from(schema.marketOrders).where(eq(schema.marketOrders.status, 'active')),
      db.select({ count: sql<number>`count(*)::int` }).from(schema.guilds),
      db.select({ count: sql<number>`count(*)::int` }).from(schema.partyBoats).where(eq(schema.partyBoats.status, 'active')),
      db.select({ count: sql<number>`count(*)::int` }).from(schema.arcaneSacrificeRounds),
      db.select({ count: sql<number>`count(*)::int` }).from(schema.dailyCheckIns),
    ]);
    const totals = await db.select({
      gold: sql<number>`coalesce(sum(gold),0)::bigint`,
      relics: sql<number>`coalesce(sum(relics),0)::bigint`,
      fragments: sql<number>`coalesce(sum(fragments),0)::bigint`,
    }).from(schema.players);
    return {
      counts: {
        players: Number(players[0]?.count ?? 0),
        accounts: Number(accounts[0]?.count ?? 0),
        activeRuns: Number(runs[0]?.count ?? 0),
        activeOrders: Number(orders[0]?.count ?? 0),
        guilds: Number(guilds[0]?.count ?? 0),
        partyBoats: Number(boats[0]?.count ?? 0),
        sacrificeRounds: Number(rounds[0]?.count ?? 0),
        todayCheckIns: Number(today[0]?.count ?? 0),
      },
      economy: {
        gold: Number(totals[0]?.gold ?? 0),
        relics: Number(totals[0]?.relics ?? 0),
        fragments: Number(totals[0]?.fragments ?? 0),
      },
      serverTime: new Date().toISOString(),
    };
  });

  // ============ players ============
  app.get('/api/admin/players', async (req, reply) => {
    await requireAdmin(req, reply);
    const q = req.query as any;
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(100, Number(q.limit ?? 30));
    const search = String(q.q ?? '');
    const conds: any[] = [];
    if (search) {
      conds.push(sql`(${schema.players.nickname} ilike ${'%' + search + '%'} OR ${schema.players.publicId}::text like ${'%' + search + '%'} OR EXISTS (SELECT 1 FROM accounts a WHERE a.id = ${schema.players.accountId} AND a.email ilike ${'%' + search + '%'}))`);
    }
    const rows = await db.select().from(schema.players).where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(schema.players.level)).limit(limit).offset((page - 1) * limit);
    const total = await db.select({ count: sql<number>`count(*)::int` }).from(schema.players).where(conds.length ? and(...conds) : undefined);
    return {
      players: rows.map((p) => ({
        id: p.id, publicId: p.publicId, nickname: p.nickname, level: p.level,
        experience: p.experience, gold: p.gold, relics: p.relics, fragments: p.fragments,
        unspentStatPoints: p.unspentStatPoints, marketAccessStatus: p.marketAccessStatus,
        currentBiomeId: p.currentBiomeId, createdAt: p.createdAt.toISOString(),
        totalCasts: p.totalCasts, totalFishCaught: p.totalFishCaught,
      })),
      total: Number(total[0]?.count ?? 0),
      page, limit,
    };
  });

  app.post('/api/admin/players/:playerId/grant', async (req, reply) => {
    await requireAdmin(req, reply);
    const playerId = String((req.params as any).playerId);
    const body = z.object({
      gold: z.number().int().optional().default(0),
      relics: z.number().int().optional().default(0),
      fragments: z.number().int().optional().default(0),
      statPoints: z.number().int().optional().default(0),
    }).parse(req.body as any);
    const p = (await db.select().from(schema.players).where(eq(schema.players.id, playerId)))[0];
    if (!p) throw new AppError('PLAYER_NOT_FOUND', '玩家不存在。');
    await db.update(schema.players).set({
      gold: sql`${schema.players.gold} + ${Math.max(0, body.gold)}`,
      relics: sql`${schema.players.relics} + ${Math.max(0, body.relics)}`,
      fragments: sql`${schema.players.fragments} + ${Math.max(0, body.fragments)}`,
      unspentStatPoints: sql`${schema.players.unspentStatPoints} + ${Math.max(0, body.statPoints)}`,
    }).where(eq(schema.players.id, playerId));
    await audit(ADMIN_USERNAME, 'player.grant', 'player', playerId, body);
    return { success: true };
  });

  app.post('/api/admin/players/:playerId/level', async (req, reply) => {
    await requireAdmin(req, reply);
    const playerId = String((req.params as any).playerId);
    const body = z.object({ level: z.number().int().min(1).max(100000) }).parse(req.body as any);
    const p = (await db.select().from(schema.players).where(eq(schema.players.id, playerId)))[0];
    if (!p) throw new AppError('PLAYER_NOT_FOUND', '玩家不存在。');
    await db.update(schema.players).set({ level: body.level, experience: 0 }).where(eq(schema.players.id, playerId));
    await audit(ADMIN_USERNAME, 'player.set_level', 'player', playerId, { from: p.level, to: body.level });
    return { success: true };
  });

  app.post('/api/admin/players/:playerId/ban', async (req, reply) => {
    await requireAdmin(req, reply);
    const playerId = String((req.params as any).playerId);
    const body = z.object({ reason: z.string().max(200).optional().default(''), expiresAt: z.string().optional().nullable().default(null) }).parse(req.body as any);
    const p = (await db.select().from(schema.players).where(eq(schema.players.id, playerId)))[0];
    if (!p) throw new AppError('PLAYER_NOT_FOUND', '玩家不存在。');
    // ban = revoke sessions + restrict market
    await db.update(schema.players).set({ marketAccessStatus: 'banned' }).where(eq(schema.players.id, playerId));
    await db.delete(schema.sessions).where(eq(schema.sessions.accountId, p.accountId));
    await db.execute(sql`INSERT INTO banned_players (player_id, reason, expires_at, created_at) VALUES (${playerId}, ${body.reason}, ${body.expiresAt ? new Date(body.expiresAt) : null}, now()) ON CONFLICT (player_id) DO UPDATE SET reason = EXCLUDED.reason, expires_at = EXCLUDED.expires_at`);
    return { success: true };
  });

  app.post('/api/admin/players/:playerId/unban', async (req, reply) => {
    await requireAdmin(req, reply);
    const playerId = String((req.params as any).playerId);
    await db.update(schema.players).set({ marketAccessStatus: 'enabled' }).where(eq(schema.players.id, playerId));
    await db.execute(sql`DELETE FROM banned_players WHERE player_id = ${playerId}`);
    return { success: true };
  });

  app.post('/api/admin/players/:playerId/rename', async (req, reply) => {
    await requireAdmin(req, reply);
    const playerId = String((req.params as any).playerId);
    const nickname = z.string().trim().min(2).max(24).parse((req.body as any)?.nickname);
    const taken = await db.select().from(schema.players).where(eq(schema.players.nickname, nickname));
    if (taken.length && taken[0].id !== playerId) throw new AppError('NICKNAME_TAKEN', '角色名已被使用。');
    await db.update(schema.players).set({ nickname }).where(eq(schema.players.id, playerId));
    await audit(ADMIN_USERNAME, 'player.rename', 'player', playerId, { nickname });
    return { success: true };
  });

  app.post('/api/admin/players/:playerId/reset-password', async (req, reply) => {
    await requireAdmin(req, reply);
    const playerId = String((req.params as any).playerId);
    const body = z.object({ password: z.string().min(8).max(64).optional() }).parse(req.body as any);
    const p = (await db.select().from(schema.players).where(eq(schema.players.id, playerId)))[0];
    if (!p) throw new AppError('PLAYER_NOT_FOUND', '玩家不存在。');
    const password = body.password ?? ('Tide-' + randomBytes(6).toString('base64url') + '!7');
    await db.update(schema.accounts).set({ passwordHash: await argon2.hash(password) }).where(eq(schema.accounts.id, p.accountId));
    await db.delete(schema.sessions).where(eq(schema.sessions.accountId, p.accountId));
    await audit(ADMIN_USERNAME, 'player.reset_password', 'player', playerId);
    return { success: true, temporaryPassword: body.password ? undefined : password };
  });

  app.post('/api/admin/players/:playerId/clear-fishing', async (req, reply) => {
    await requireAdmin(req, reply);
    const playerId = String((req.params as any).playerId);
    await db.update(schema.fishingRuns).set({ status: 'completed', endedAt: new Date(), endReason: 'admin' }).where(and(
      eq(schema.fishingRuns.playerId, playerId), eq(schema.fishingRuns.status, 'running'),
    ));
    return { success: true };
  });

  // ============ CDK codes ============
  app.get('/api/admin/cdks', async (req, reply) => {
    await requireAdmin(req, reply);
    const rows = await db.select().from(schema.cdkCodes).orderBy(desc(schema.cdkCodes.createdAt)).limit(100);
    return { items: rows.map((c) => ({
      code: c.code, kind: c.kind, payload: c.payload, maxRedemptions: c.maxRedemptions,
      redemptions: c.redemptions, expiresAt: c.expiresAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString(),
    })) };
  });

  app.post('/api/admin/cdks', async (req, reply) => {
    await requireAdmin(req, reply);
    const body = z.object({
      count: z.number().int().min(1).max(100).default(1),
      kind: z.string().default('reward'),
      gold: z.number().int().optional().default(0),
      relics: z.number().int().optional().default(0),
      fragments: z.number().int().optional().default(0),
      chestId: z.string().optional().nullable().default(null),
      chestQuantity: z.number().int().optional().default(1),
      maxRedemptions: z.number().int().min(1).max(1000).default(1),
      expiresDays: z.number().int().optional().nullable().default(null),
      prefix: z.string().max(8).optional().default('ARC'),
    }).parse(req.body as any);
    const codes: string[] = [];
    const rows = [];
    for (let i = 0; i < body.count; i++) {
      const code = `${body.prefix.toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
      codes.push(code);
      rows.push({
        code,
        kind: body.kind,
        payload: {
          gold: body.gold, relics: body.relics, fragments: body.fragments,
          chestId: body.chestId, quantity: body.chestQuantity,
        },
        maxRedemptions: body.maxRedemptions,
        expiresAt: body.expiresDays ? new Date(Date.now() + body.expiresDays * 86400000) : null,
      });
    }
    await db.insert(schema.cdkCodes).values(rows as any);
    return { codes };
  });

  app.post('/api/admin/cdks/:code/revoke', async (req, reply) => {
    await requireAdmin(req, reply);
    const code = String((req.params as any).code);
    await db.delete(schema.cdkCodes).where(eq(schema.cdkCodes.code, code));
    return { success: true };
  });

  // ============ events ============
  app.post('/api/admin/events/sacrifice/round', async (req, reply) => {
    await requireAdmin(req, reply);
    const body = z.object({
      resourceType: z.enum(['fish', 'gold', 'relic']),
      target: z.number().int().min(1),
      surgeHours: z.number().int().min(1).max(24).default(4),
    }).parse(req.body as any);
    // close any open round
    await db.update(schema.arcaneSacrificeRounds).set({ status: 'completed', completedAt: new Date(), effectEndsAt: new Date() }).where(eq(schema.arcaneSacrificeRounds.status, 'open'));
    const today = chinaDate();
    const existing = await db.select().from(schema.arcaneSacrificeRounds).where(eq(schema.arcaneSacrificeRounds.dayDate, today));
    const roundNumber = existing.length + 1;
    await db.insert(schema.arcaneSacrificeRounds).values({
      dayDate: today,
      roundNumber,
      cycleOrdinal: roundNumber,
      resourceType: body.resourceType,
      target: body.target,
      progress: 0,
      status: 'open',
      opensAt: new Date(),
    });
    return { success: true, roundNumber };
  });

  app.post('/api/admin/events/sacrifice/complete', async (req, reply) => {
    await requireAdmin(req, reply);
    const round = (await db.select().from(schema.arcaneSacrificeRounds).where(eq(schema.arcaneSacrificeRounds.status, 'open')).orderBy(asc(schema.arcaneSacrificeRounds.roundNumber)).limit(1))[0];
    if (!round) throw new AppError('NO_OPEN_ROUND', '当前没有进行中的轮次。');
    await db.update(schema.arcaneSacrificeRounds).set({
      status: 'completed', completedAt: new Date(),
      progress: round.target,
      effectEndsAt: new Date(Date.now() + 4 * 3600 * 1000),
    }).where(eq(schema.arcaneSacrificeRounds.id, round.id));
    return { success: true };
  });

  // ============ weather / content control ============
  app.post('/api/admin/weather/override', async (req, reply) => {
    await requireAdmin(req, reply);
    const body = z.object({ weatherId: z.string(), biomeId: z.string().optional().nullable().default(null) }).parse(req.body as any);
    const key = body.biomeId ? `weatherOverride:${body.biomeId}` : 'weatherOverride:all';
    await db.insert(schema.globalSettings).values({ key, value: { weatherId: body.weatherId, setAt: new Date().toISOString() } })
      .onConflictDoUpdate({ target: [schema.globalSettings.key], set: { value: { weatherId: body.weatherId, setAt: new Date().toISOString() } } });
    return { success: true };
  });

  app.post('/api/admin/weather/clear-override', async (req, reply) => {
    await requireAdmin(req, reply);
    const biomeId = (req.body as any)?.biomeId ?? null;
    const key = biomeId ? `weatherOverride:${biomeId}` : 'weatherOverride:all';
    await db.delete(schema.globalSettings).where(eq(schema.globalSettings.key, key));
    return { success: true };
  });

  // ============ content ============
  app.get('/api/admin/content/overview', async (req, reply) => {
    await requireAdmin(req, reply);
    const [biomes, fish, rods, baits, weather, chests, achievements, titles, talents, quests] = await Promise.all([
      db.select().from(schema.biomes),
      db.select().from(schema.fish),
      db.select().from(schema.rods),
      db.select().from(schema.baits),
      db.select().from(schema.weather),
      db.select().from(schema.chests),
      db.select().from(schema.achievementDefinitions),
      db.select().from(schema.titles),
      db.select().from(schema.talents),
      db.select().from(schema.questTemplates),
    ]);
    return {
      counts: {
        biomes: biomes.length, fish: fish.length, rods: rods.length, baits: baits.length,
        weather: weather.length, chests: chests.length, achievements: achievements.length,
        titles: titles.length, talents: talents.length, questTemplates: quests.length,
      },
      biomes: biomes.map((b) => ({ id: b.id, name: b.name, requiredLevel: b.requiredLevel, unlockCost: b.unlockCost, valueMultiplier: b.valueMultiplier })),
      fish: fish.map((f) => ({ id: f.id, name: f.name, biomeId: f.biomeId, rarity: f.rarity, sellPrice: f.sellPrice })),
    };
  });

  // ============ fish & biome CRUD ============
  app.get('/api/admin/content/fish', async (req, reply) => {
    await requireAdmin(req, reply);
    const q = req.query as any;
    const search = String(q.q ?? '').trim();
    const biomeId = String(q.biomeId ?? '').trim();
    const rows = await db.select().from(schema.fish).where(and(
      search ? sql`(${schema.fish.name} ilike ${'%' + search + '%'} OR ${schema.fish.id} ilike ${'%' + search + '%'})` : undefined,
      biomeId ? eq(schema.fish.biomeId, biomeId) : undefined,
    )).orderBy(asc(schema.fish.biomeId), asc(schema.fish.rarity), desc(schema.fish.sellPrice)).limit(Math.min(500, Number(q.limit ?? 200)));
    return { items: rows };
  });

  app.post('/api/admin/content/fish', async (req, reply) => {
    await requireAdmin(req, reply);
    const body = z.object({
      id: z.string().min(2).max(64).regex(/^[a-z0-9_]+$/),
      name: z.string().min(1).max(64),
      description: z.string().max(255).default(''),
      biomeId: z.string().min(1).max(16),
      rarity: z.string().min(1).max(16),
      sellPrice: z.number().int().min(0),
      imagePath: z.string().max(255).default(''),
    }).parse(req.body as any);
    const existing = await db.select().from(schema.fish).where(eq(schema.fish.id, body.id));
    if (existing.length) throw new AppError('FISH_EXISTS', '鱼种 ID 已存在。');
    const row = (await db.insert(schema.fish).values(body).returning())[0];
    await audit(ADMIN_USERNAME, 'content.fish.create', 'fish', row.id, body);
    return { item: row };
  });

  app.put('/api/admin/content/fish/:fishId', async (req, reply) => {
    await requireAdmin(req, reply);
    const fishId = String((req.params as any).fishId);
    const body = z.object({
      name: z.string().min(1).max(64).optional(),
      description: z.string().max(255).optional(),
      biomeId: z.string().min(1).max(16).optional(),
      rarity: z.string().min(1).max(16).optional(),
      sellPrice: z.number().int().min(0).optional(),
      imagePath: z.string().max(255).optional(),
    }).parse(req.body as any);
    const row = (await db.update(schema.fish).set(body).where(eq(schema.fish.id, fishId)).returning())[0];
    if (!row) throw new AppError('FISH_NOT_FOUND', '鱼种不存在。', 404);
    await audit(ADMIN_USERNAME, 'content.fish.update', 'fish', fishId, body);
    return { item: row };
  });

  app.delete('/api/admin/content/fish/:fishId', async (req, reply) => {
    await requireAdmin(req, reply);
    const fishId = String((req.params as any).fishId);
    const used = await db.select({ count: sql<number>`count(*)::int` }).from(schema.playerInventoryFish).where(eq(schema.playerInventoryFish.fishId, fishId));
    if (Number(used[0]?.count ?? 0) > 0) throw new AppError('FISH_IN_USE', '背包中仍有该鱼获，暂不能删除。');
    await db.delete(schema.fish).where(eq(schema.fish.id, fishId));
    await audit(ADMIN_USERNAME, 'content.fish.delete', 'fish', fishId);
    return { success: true };
  });

  app.get('/api/admin/content/biomes', async (req, reply) => {
    await requireAdmin(req, reply);
    const rows = await db.select().from(schema.biomes).orderBy(asc(schema.biomes.orderIndex));
    const fishCounts = await db.select({ biomeId: schema.fish.biomeId, count: sql<number>`count(*)::int` }).from(schema.fish).groupBy(schema.fish.biomeId);
    const countMap = new Map(fishCounts.map((x) => [x.biomeId, Number(x.count)]));
    return { items: rows.map((row) => ({ ...row, fishCount: countMap.get(row.id) ?? 0 })) };
  });

  app.post('/api/admin/content/biomes', async (req, reply) => {
    await requireAdmin(req, reply);
    const body = z.object({
      id: z.string().regex(/^b_\d{3}$/), name: z.string().min(1).max(32), theme: z.string().min(1).max(500),
      requiredLevel: z.number().int().min(0), unlockCost: z.number().int().min(0), valueMultiplier: z.number().min(1).max(10),
      directGoldMin: z.number().int().min(0).default(50), directGoldMax: z.number().int().min(0).default(100),
      orderIndex: z.number().int().min(0).default(0),
    }).parse(req.body as any);
    const row = (await db.insert(schema.biomes).values(body).returning())[0];
    await audit(ADMIN_USERNAME, 'content.biome.create', 'biome', row.id, body);
    return { item: row };
  });

  app.put('/api/admin/content/biomes/:biomeId', async (req, reply) => {
    await requireAdmin(req, reply);
    const biomeId = String((req.params as any).biomeId);
    const body = z.object({
      name: z.string().min(1).max(32).optional(), theme: z.string().min(1).max(500).optional(),
      requiredLevel: z.number().int().min(0).optional(), unlockCost: z.number().int().min(0).optional(),
      valueMultiplier: z.number().min(1).max(10).optional(), directGoldMin: z.number().int().min(0).optional(),
      directGoldMax: z.number().int().min(0).optional(), orderIndex: z.number().int().min(0).optional(),
    }).parse(req.body as any);
    const row = (await db.update(schema.biomes).set(body).where(eq(schema.biomes.id, biomeId)).returning())[0];
    if (!row) throw new AppError('BIOME_NOT_FOUND', '地图不存在。', 404);
    await audit(ADMIN_USERNAME, 'content.biome.update', 'biome', biomeId, body);
    return { item: row };
  });

  // ============ announcements ============
  app.get('/api/admin/announcements', async (req, reply) => {
    await requireAdmin(req, reply);
    return { items: await db.select().from(schema.announcements).orderBy(desc(schema.announcements.createdAt)).limit(100) };
  });

  app.post('/api/admin/announcements', async (req, reply) => {
    await requireAdmin(req, reply);
    const body = z.object({ title: z.string().min(1).max(80), body: z.string().min(1).max(4000), level: z.enum(['info','success','warning','danger']).default('info'), expiresAt: z.string().datetime().nullable().optional() }).parse(req.body as any);
    const row = (await db.insert(schema.announcements).values({ title: body.title, body: body.body, level: body.level, expiresAt: body.expiresAt ? new Date(body.expiresAt) : null }).returning())[0];
    await audit(ADMIN_USERNAME, 'announcement.create', 'announcement', row.id, { title: row.title });
    return { item: row };
  });

  app.put('/api/admin/announcements/:announcementId', async (req, reply) => {
    await requireAdmin(req, reply);
    const id = String((req.params as any).announcementId);
    const body = z.object({ title: z.string().min(1).max(80).optional(), body: z.string().min(1).max(4000).optional(), level: z.enum(['info','success','warning','danger']).optional(), isActive: z.boolean().optional() }).parse(req.body as any);
    const row = (await db.update(schema.announcements).set(body).where(eq(schema.announcements.id, id)).returning())[0];
    if (!row) throw new AppError('ANNOUNCEMENT_NOT_FOUND', '公告不存在。', 404);
    await audit(ADMIN_USERNAME, 'announcement.update', 'announcement', id, body);
    return { item: row };
  });

  app.delete('/api/admin/announcements/:announcementId', async (req, reply) => {
    await requireAdmin(req, reply);
    const id = String((req.params as any).announcementId);
    const row = (await db.delete(schema.announcements).where(eq(schema.announcements.id, id)).returning())[0];
    if (!row) throw new AppError('ANNOUNCEMENT_NOT_FOUND', '公告不存在。', 404);
    await audit(ADMIN_USERNAME, 'announcement.delete', 'announcement', id, { title: row.title });
    return { success: true };
  });

  // ============ settings ============
  app.get('/api/admin/settings', async (req, reply) => {
    await requireAdmin(req, reply);
    return { items: await db.select().from(schema.globalSettings).orderBy(asc(schema.globalSettings.key)) };
  });

  app.put('/api/admin/settings/:key', async (req, reply) => {
    await requireAdmin(req, reply);
    const key = String((req.params as any).key);
    const body = z.object({ value: z.unknown() }).parse(req.body as any);
    const row = (await db.insert(schema.globalSettings).values({ key, value: body.value })
      .onConflictDoUpdate({ target: [schema.globalSettings.key], set: { value: body.value, updatedAt: new Date() } }).returning())[0];
    const auditValue = key === 'mail.smtp' && body.value && typeof body.value === 'object'
      ? { ...(body.value as Record<string, unknown>), password: body.value && (body.value as any).password ? '***' : '' }
      : body.value;
    await audit(ADMIN_USERNAME, 'setting.update', 'setting', key, { value: auditValue });
    return { item: row };
  });

  app.post('/api/admin/mail/test', async (req, reply) => {
    await requireAdmin(req, reply);
    const body = z.object({ to: z.string().email() }).parse(req.body as any);
    await sendMail(body.to, '【奥术摸鱼大师】邮件配置测试', '如果你收到这封邮件，说明 SMTP 邮件服务配置成功。');
    await audit(ADMIN_USERNAME, 'settings.mail_test', 'mail', body.to, {});
    return { success: true };
  });

  // ============ market / social oversight ============
  app.get('/api/admin/market/orders', async (req, reply) => {
    await requireAdmin(req, reply);
    const rows = await db.select().from(schema.marketOrders).orderBy(desc(schema.marketOrders.createdAt)).limit(200);
    const owners = await db.select({ id: schema.players.id, nickname: schema.players.nickname, publicId: schema.players.publicId }).from(schema.players);
    const ownerMap = new Map(owners.map((o) => [o.id, o]));
    return { items: rows.map((o) => ({ ...o, owner: ownerMap.get(o.ownerId) ?? null })) };
  });

  app.post('/api/admin/market/orders/:orderId/cancel', async (req, reply) => {
    await requireAdmin(req, reply);
    const id = String((req.params as any).orderId);
    const row = (await db.update(schema.marketOrders).set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() }).where(eq(schema.marketOrders.id, id)).returning())[0];
    if (!row) throw new AppError('ORDER_NOT_FOUND', '订单不存在。', 404);
    await audit(ADMIN_USERNAME, 'market.order.cancel', 'market_order', id);
    return { success: true };
  });

  app.get('/api/admin/social/overview', async (req, reply) => {
    await requireAdmin(req, reply);
    const [guilds, boats, members] = await Promise.all([
      db.select().from(schema.guilds).orderBy(desc(schema.guilds.level)).limit(100),
      db.select().from(schema.partyBoats).orderBy(desc(schema.partyBoats.createdAt)).limit(100),
      db.select({ guildId: schema.guildMembers.guildId, count: sql<number>`count(*)::int` }).from(schema.guildMembers).groupBy(schema.guildMembers.guildId),
    ]);
    const memberMap = new Map(members.map((m) => [m.guildId, Number(m.count)]));
    return { guilds: guilds.map((g) => ({ ...g, memberCount: memberMap.get(g.id) ?? 0 })), boats };
  });

  app.get('/api/admin/audit', async (req, reply) => {
    await requireAdmin(req, reply);
    const limit = Math.min(500, Number((req.query as any).limit ?? 200));
    return { items: await db.select().from(schema.adminAuditLogs).orderBy(desc(schema.adminAuditLogs.createdAt)).limit(limit) };
  });

  // ============ leaderboard ============
  app.post('/api/admin/leaderboards/regenerate', async (req, reply) => {
    await requireAdmin(req, reply);
    const today = chinaDate();
    const categories = ['level', 'gold', 'totalCasts', 'totalFishCaught', 'fishpedia'];
    for (const category of categories) {
      const entries = await computeFor(category);
      await db.insert(schema.leaderboardSnapshots).values({ category, date: today, generatedAt: new Date(), entries })
        .onConflictDoUpdate({ target: [schema.leaderboardSnapshots.category, schema.leaderboardSnapshots.date], set: { entries, generatedAt: new Date() } });
    }
    return { success: true, date: today };
  });

  // ============ global buff ============
  app.post('/api/admin/global-buff', async (req, reply) => {
    await requireAdmin(req, reply);
    const body = z.object({
      buffType: z.enum(['experience', 'gold', 'strength', 'intelligence', 'luck', 'endurance']),
      bonusBasisPoints: z.number().int(),
      durationHours: z.number().int().min(1).max(720),
    }).parse(req.body as any);
    await db.insert(schema.globalBuffs).values({
      buffType: body.buffType,
      bonusBasisPoints: body.bonusBasisPoints,
      startsAt: new Date(),
      endsAt: new Date(Date.now() + body.durationHours * 3600 * 1000),
    });
    return { success: true };
  });

  // ============ logs ============
  app.get('/api/admin/logs', async (req, reply) => {
    await requireAdmin(req, reply);
    const q = req.query as any;
    const limit = Math.min(200, Number(q.limit ?? 100));
    const [loginLogs, redemptionLogs] = await Promise.all([
      db.select().from(schema.playerLoginLogs).orderBy(desc(schema.playerLoginLogs.createdAt)).limit(limit),
      db.select().from(schema.cdkRedemptions).orderBy(desc(schema.cdkRedemptions.redeemedAt)).limit(limit),
    ]);
    return {
      logins: loginLogs.map((l) => ({ playerId: l.playerId, ip: l.ip, userAgent: l.userAgent, createdAt: l.createdAt.toISOString() })),
      redemptions: redemptionLogs.map((r) => ({ code: r.code, playerId: r.playerId, redeemedAt: r.redeemedAt.toISOString() })),
    };
  });
}

function chinaDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const china = new Date(d.getTime() + 8 * 3600 * 1000);
  return `${china.getUTCFullYear()}-${p(china.getUTCMonth() + 1)}-${p(china.getUTCDate())}`;
}

async function computeFor(category: string): Promise<Array<{ playerId: string; rank: number; value: number; secondaryValue?: number }>> {
  const rows = await db.select({
    playerId: schema.players.id,
    value: category === 'level' ? schema.players.level : category === 'gold' ? schema.players.gold : category === 'totalCasts' ? schema.players.totalCasts : schema.players.totalFishCaught,
    secondaryValue: category === 'level' ? schema.players.experience : sql<number>`0`,
  }).from(schema.players).orderBy(desc(category === 'level' ? schema.players.level : category === 'gold' ? schema.players.gold : category === 'totalCasts' ? schema.players.totalCasts : schema.players.totalFishCaught)).limit(500);
  return rows.map((r, i) => ({ playerId: r.playerId, rank: i + 1, value: Number(r.value), secondaryValue: Number(r.secondaryValue ?? 0) }));
}
