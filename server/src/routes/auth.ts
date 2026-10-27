import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import argon2 from 'argon2';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { AppError } from '../util/errors.js';
import { SESSION_COOKIE, requireAuth, requireAuthOrNull } from '../services/auth.js';
import { USER_AGREEMENT_VERSION } from '../constants.js';
import { loadPlayerContext } from '../services/playerState.js';
import { sendVerificationCode } from '../services/mail.js';
import { loadMailConfig, loadRegistrationPolicy } from '../services/siteConfig.js';
import { randomUUID } from 'node:crypto';

const sessionMaxAgeMs = 30 * 24 * 60 * 60 * 1000;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const emailCodes = new Map<string, { code: string; purpose: 'register' | 'reset' | 'verify'; expiresAt: number; nextSendAt: number }>();

function issueEmailCode(email: string, purpose: 'register' | 'reset' | 'verify') {
  const code = purpose === 'register' ? (process.env.NODE_ENV === 'production' ? String(Math.floor(100000 + Math.random() * 900000)) : (process.env.EMAIL_VERIFICATION_CODE || '123456')) : String(Math.floor(100000 + Math.random() * 900000));
  const now = Date.now();
  emailCodes.set(email.toLowerCase() + ':' + purpose, { code, purpose, expiresAt: now + 10 * 60_000, nextSendAt: now + 60_000 });
  console.log(`[auth] ${purpose} code for ${email}: ${code}`);
  return { code, expiresAt: new Date(now + 10 * 60_000).toISOString(), nextSendAt: new Date(now + 60_000).toISOString() };
}

function verifyEmailCode(email: string, purpose: 'register' | 'reset' | 'verify', code: string) {
  const record = emailCodes.get(email.toLowerCase() + ':' + purpose);
  if (record && record.expiresAt > Date.now() && record.code === code) {
    emailCodes.delete(email.toLowerCase() + ':' + purpose);
    return true;
  }
  return process.env.NODE_ENV !== 'production' && (code === '123456' || code === '000000');
}


async function deliverEmailCode(email: string, purpose: 'register' | 'reset' | 'verify', issued: { code: string; expiresAt: string; nextSendAt: string }) {
  const mail = await loadMailConfig();
  if (mail.enabled) {
    try {
      await sendVerificationCode(email, issued.code, purpose);
      return { delivery: 'smtp' as const, devCode: undefined };
    } catch (error) {
      throw new AppError('EMAIL_DELIVERY_FAILED', `验证码邮件发送失败：${error instanceof Error ? error.message : '未知错误'}`, 502);
    }
  }
  if (process.env.NODE_ENV === 'production') {
    throw new AppError('EMAIL_NOT_CONFIGURED', '邮件服务尚未配置，请联系管理员。', 503);
  }
  return { delivery: 'console' as const, devCode: issued.code };
}

function loginKey(req: FastifyRequest, email: string) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown') + ':' + email.toLowerCase();
}

function checkLoginRate(req: FastifyRequest, email: string) {
  const key = loginKey(req, email);
  const current = loginAttempts.get(key);
  if (current && current.resetAt > Date.now() && current.count >= 10) {
    throw new AppError('LOGIN_RATE_LIMITED', '登录尝试过于频繁，请 10 分钟后再试。', 429);
  }
  return key;
}

function recordLoginFailure(key: string) {
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= Date.now()) loginAttempts.set(key, { count: 1, resetAt: Date.now() + 10 * 60_000 });
  else current.count++;
}


function setSessionCookie(reply: any, sessionId: string) {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(sessionMaxAgeMs / 1000),
  });
}

const nicknameSchema = z.string().trim().min(2).max(24);
const emailSchema = z.string().trim().email();
const passwordSchema = z.string().min(6).max(20);

async function nextPublicId(): Promise<number> {
  const row = await db.execute(sql`SELECT COALESCE(MAX(public_id), 10000) + 1 AS next FROM players`);
  const next = Number(row.rows[0]?.next ?? 10001);
  return Math.max(10001, next);
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post('/api/auth/register', async (req, reply) => {
    const registrationPolicy = await loadRegistrationPolicy();
    if (!registrationPolicy.allowRegistration) throw new AppError('REGISTRATION_CLOSED', '当前暂停新账号注册。', 403);
    const body = z.object({
      email: emailSchema,
      password: passwordSchema,
      nickname: nicknameSchema,
      acceptedUserAgreement: z.boolean(),
      acceptedUserAgreementVersion: z.string(),
      emailVerificationCode: z.string().regex(/^\d{6}$/).optional(),
    }).parse(req.body as any);

    if (registrationPolicy.requireEmailVerification && !body.emailVerificationCode) {
      throw new AppError('EMAIL_CODE_REQUIRED', '请输入邮箱验证码。');
    }
    if (body.emailVerificationCode && !verifyEmailCode(body.email, 'register', body.emailVerificationCode)) {
      throw new AppError('INVALID_EMAIL_CODE', '邮箱验证码不正确或已过期。');
    }
    if (registrationPolicy.requireAgreement && (!body.acceptedUserAgreement || body.acceptedUserAgreementVersion !== USER_AGREEMENT_VERSION)) {
      throw new AppError('USER_AGREEMENT_REQUIRED', '注册前需要阅读并同意用户协议与游戏规则。');
    }

    const existing = await db.select().from(schema.accounts).where(eq(schema.accounts.email, body.email.toLowerCase()));
    if (existing.length) throw new AppError('EMAIL_TAKEN', '该邮箱已注册，请直接登录。');

    const nicknameTaken = await db.select().from(schema.players).where(eq(schema.players.nickname, body.nickname));
    if (nicknameTaken.length) throw new AppError('NICKNAME_TAKEN', '该角色名已被使用，请更换一个。');

    const passwordHash = await argon2.hash(body.password);
    const account = (await db.insert(schema.accounts).values({
      email: body.email.toLowerCase(),
      passwordHash,
      acceptedUserAgreementVersion: body.acceptedUserAgreementVersion,
    }).returning())[0];

    const publicId = await nextPublicId();
    const player = (await db.insert(schema.players).values({
      accountId: account.id,
      publicId,
      nickname: body.nickname,
      baseEndurance: 100,
    }).returning())[0];

    // initialize player state
    const [biomes, rods, baits, chests, talentIds, avatarIds, titles, achievements, targets] = await Promise.all([
      db.select().from(schema.biomes),
      db.select().from(schema.rods),
      db.select().from(schema.baits),
      db.select().from(schema.chests),
      db.select().from(schema.talents),
      db.select().from(schema.avatars),
      db.select().from(schema.titles),
      db.select().from(schema.achievementDefinitions),
      db.select().from(schema.masteryTargets),
    ]);

    await db.insert(schema.playerBiomes).values(
      biomes.map((b) => ({ playerId: player.id, biomeId: b.id, isUnlocked: b.id === 'b_001' })),
    );
    await db.insert(schema.playerRods).values(
      rods.map((r) => ({ playerId: player.id, rodId: r.id, isOwned: r.id === 'novice_rod', level: 1 })),
    );
    await db.insert(schema.playerBaits).values(
      baits.map((b) => ({ playerId: player.id, baitId: b.id, quantity: b.isUnlimited ? 0 : 0 })),
    );
    await db.insert(schema.playerChests).values(
      chests.map((c) => ({ playerId: player.id, chestId: c.id, quantity: 0 })),
    );
    await db.insert(schema.playerTalents).values(
      talentIds.map((t) => ({ playerId: player.id, talentId: t.id, rank: 0 })),
    );
    await db.insert(schema.playerAvatars).values(
      avatarIds.filter((a) => a.source === 'base').map((a) => ({ playerId: player.id, avatarId: a.id })),
    );
    await db.insert(schema.playerAchievements).values(
      achievements.map((a) => ({ playerId: player.id, achievementId: a.id, progress: 0, status: 'in_progress' })),
    );
    await db.insert(schema.playerMasteryProgress).values(
      targets.map((t) => ({ playerId: player.id, targetId: t.id, completedLevel: 0, contributedQuantity: 0 })),
    );
    // default daily harvest row
    await db.insert(schema.dailyHarvest).values({ playerId: player.id, date: chinaDate(), casts: 0 });
    await db.insert(schema.playerReincarnations).values({ playerId: player.id });

    const session = (await db.insert(schema.sessions).values({
      accountId: account.id,
      expiresAt: new Date(Date.now() + sessionMaxAgeMs),
    }).returning())[0];
    setSessionCookie(reply, session.id);

    return buildSession(player);
  });

  app.post('/api/auth/email-verification/captcha-challenge', async (req) => {
    const body = z.object({ email: emailSchema, nickname: z.string().optional() }).parse(req.body as any);
    return { required: false, provider: null, appId: null, aidEncrypted: null, aidEncryptedType: null, email: body.email, serverTime: new Date().toISOString() };
  });

  app.post('/api/auth/email-verification/send', async (req) => {
    const body = z.object({ email: emailSchema, nickname: z.string().optional(), captcha: z.unknown().optional() }).parse(req.body as any);
    const issued = issueEmailCode(body.email, 'register');
    const delivery = await deliverEmailCode(body.email, 'register', issued);
    return { verificationId: body.email, nextSendAt: issued.nextSendAt, expiresAt: issued.expiresAt, serverTime: new Date().toISOString(), delivery: delivery.delivery, ...(delivery.devCode ? { devCode: delivery.devCode } : {}) };
  });

  app.post('/api/account/email-verification/captcha-challenge', async (req) => {
    const body = z.object({ email: emailSchema }).parse(req.body as any);
    return { required: false, provider: null, appId: null, aidEncrypted: null, aidEncryptedType: null, email: body.email, serverTime: new Date().toISOString() };
  });

  app.post('/api/account/email-verification/send', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({ email: emailSchema, captcha: z.unknown().optional() }).parse(req.body as any);
    const account = (await db.select().from(schema.accounts).where(eq(schema.accounts.id, player.accountId)))[0];
    if (!account || account.email !== body.email.toLowerCase()) throw new AppError('EMAIL_MISMATCH', '请使用当前账号绑定的邮箱。');
    const issued = issueEmailCode(body.email, 'verify');
    const delivery = await deliverEmailCode(body.email, 'verify', issued);
    return { verificationId: body.email, nextSendAt: issued.nextSendAt, expiresAt: issued.expiresAt, serverTime: new Date().toISOString(), delivery: delivery.delivery, ...(delivery.devCode ? { devCode: delivery.devCode } : {}) };
  });

  app.post('/api/account/email-verification/confirm', async (req, reply) => {
    await requireAuth(req, reply);
    const body = z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/) }).parse(req.body as any);
    if (!verifyEmailCode(body.email, 'verify', body.code)) throw new AppError('INVALID_EMAIL_CODE', '邮箱验证码不正确或已过期。');
    return { emailVerified: true, serverTime: new Date().toISOString() };
  });

  app.post('/api/auth/password-reset/captcha-challenge', async (req) => {
    const body = z.object({ email: emailSchema }).parse(req.body as any);
    return { required: false, provider: null, appId: null, aidEncrypted: null, aidEncryptedType: null, email: body.email, serverTime: new Date().toISOString() };
  });

  app.post('/api/auth/password-reset/send', async (req) => {
    const body = z.object({ email: emailSchema, captcha: z.unknown().optional() }).parse(req.body as any);
    const account = (await db.select().from(schema.accounts).where(eq(schema.accounts.email, body.email.toLowerCase())))[0];
    if (!account) throw new AppError('ACCOUNT_NOT_FOUND', '该邮箱尚未注册。', 404);
    const issued = issueEmailCode(body.email, 'reset');
    const delivery = await deliverEmailCode(body.email, 'reset', issued);
    return { verificationId: body.email, nextSendAt: issued.nextSendAt, expiresAt: issued.expiresAt, serverTime: new Date().toISOString(), delivery: delivery.delivery, ...(delivery.devCode ? { devCode: delivery.devCode } : {}) };
  });

  app.post('/api/auth/password-reset', async (req, reply) => {
    const body = z.object({ email: emailSchema, emailVerificationCode: z.string().regex(/^\d{6}$/), newPassword: passwordSchema }).parse(req.body as any);
    if (!verifyEmailCode(body.email, 'reset', body.emailVerificationCode)) throw new AppError('INVALID_EMAIL_CODE', '邮箱验证码不正确或已过期。');
    const account = (await db.select().from(schema.accounts).where(eq(schema.accounts.email, body.email.toLowerCase())))[0];
    if (!account) throw new AppError('ACCOUNT_NOT_FOUND', '该邮箱尚未注册。', 404);
    await db.update(schema.accounts).set({ passwordHash: await argon2.hash(body.newPassword) }).where(eq(schema.accounts.id, account.id));
    await db.delete(schema.sessions).where(eq(schema.sessions.accountId, account.id));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { success: true, serverTime: new Date().toISOString() };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ email: emailSchema, password: passwordSchema }).parse(req.body as any);
    const attemptKey = checkLoginRate(req, body.email);
    const account = (await db.select().from(schema.accounts).where(eq(schema.accounts.email, body.email.toLowerCase())))[0];
    if (!account || !(await argon2.verify(account.passwordHash, body.password))) {
      recordLoginFailure(attemptKey);
      throw new AppError('INVALID_CREDENTIALS', '邮箱或密码不正确。');
    }
    loginAttempts.delete(attemptKey);
    const player = (await db.select().from(schema.players).where(eq(schema.players.accountId, account.id)))[0];
    if (!player) throw new AppError('NO_CHARACTER', '该账号尚未创建角色。');

    const session = (await db.insert(schema.sessions).values({
      accountId: account.id,
      expiresAt: new Date(Date.now() + sessionMaxAgeMs),
    }).returning())[0];
    setSessionCookie(reply, session.id);
    return buildSession(player);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const sessionId = req.cookies?.[SESSION_COOKIE];
    if (sessionId) {
      await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
    }
    return { success: true };
  });

  app.get('/api/me', async (req, reply) => {
    const player = await requireAuthOrNull(req, reply);
    if (!player) throw new AppError('UNAUTHENTICATED', '请先登录后再继续。', 401);
    return buildSession(player);
  });

  app.post('/api/account/password', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({ currentPassword: z.string(), newPassword: passwordSchema }).parse(req.body as any);
    const account = (await db.select().from(schema.accounts).where(eq(schema.accounts.id, player.accountId)))[0];
    if (!account || !(await argon2.verify(account.passwordHash, body.currentPassword))) {
      throw new AppError('INVALID_CURRENT_PASSWORD', '当前密码不正确。');
    }
    const passwordHash = await argon2.hash(body.newPassword);
    await db.update(schema.accounts).set({ passwordHash }).where(eq(schema.accounts.id, account.id));
    // revoke other sessions
    await db.delete(schema.sessions).where(eq(schema.sessions.accountId, account.id));
    const session = (await db.insert(schema.sessions).values({
      accountId: account.id,
      expiresAt: new Date(Date.now() + sessionMaxAgeMs),
    }).returning())[0];
    setSessionCookie(reply, session.id);
    return { success: true };
  });
}

export function chinaDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const china = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return `${china.getUTCFullYear()}-${p(china.getUTCMonth() + 1)}-${p(china.getUTCDate())}`;
}

export async function buildSession(player: typeof schema.players.$inferSelect) {
  const account = (await db.select().from(schema.accounts).where(eq(schema.accounts.id, player.accountId)))[0];
  const context = await loadPlayerContext(player.id);
  const [avatar, guildMembership, boatMember] = await Promise.all([
    db.select().from(schema.avatars).where(eq(schema.avatars.id, player.avatarId)),
    db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id)),
    db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)),
  ]);

  let guildTag: string | null = null;
  if (guildMembership[0]) {
    const g = (await db.select().from(schema.guilds).where(eq(schema.guilds.id, guildMembership[0].guildId)))[0];
    guildTag = g?.tag ?? null;
  }

  const party = boatMember[0]
    ? {
        isInParty: true,
        role: boatMember[0].role,
        canChangeBoatBiome: boatMember[0].role === 'captain' || boatMember[0].role === 'helm',
        status: 'active',
        source: null,
        boatDefinitionId: null,
        boatName: null,
        visibility: null,
        boatBiomeId: null,
        rentalEndsAt: null,
        maintenanceDueAt: null,
        rosterVersion: null,
        biomeVersion: null,
        identityVersion: null,
      }
    : {
        isInParty: false,
        role: null,
        canChangeBoatBiome: false,
        status: null,
        source: null,
        boatDefinitionId: null,
        boatName: null,
        visibility: null,
        boatBiomeId: null,
        rentalEndsAt: null,
        maintenanceDueAt: null,
        rosterVersion: null,
        biomeVersion: null,
        identityVersion: null,
      };

  const title = player.equippedTitleId
    ? (await db.select().from(schema.titles).where(eq(schema.titles.id, player.equippedTitleId)))[0]
    : null;

  return {
    player: {
      id: player.id,
      nickname: player.nickname,
      level: player.level,
      experience: player.experience,
      experienceToNextLevel: nextLevelExp(player.level),
      gold: player.gold,
      goldPenaltyTotal: player.goldPenaltyTotal,
      acknowledgedGoldPenaltyTotal: player.acknowledgedGoldPenaltyTotal,
      relics: player.relics,
      fragments: player.fragments,
      unspentStatPoints: player.unspentStatPoints,
      freeRodResetCredits: player.freeRodResetCredits,
      marketAccessStatus: player.marketAccessStatus,
      canAccessMarket: player.marketAccessStatus === 'enabled',
      lighthouseEffects: {
        experienceBonusBasisPoints: context.artifacts.filter((item) => item.definition.statType === 'experience').reduce((sum, item) => sum + item.level * 2, 0),
        directGoldMinimumBonus: context.artifacts.filter((item) => item.definition.statType === 'direct_gold_min').reduce((sum, item) => sum + item.level * item.definition.baseBonus, 0),
        directGoldMaximumBonus: context.artifacts.filter((item) => item.definition.statType === 'direct_gold_max').reduce((sum, item) => sum + item.level * item.definition.baseBonus, 0),
        competitionScoreBonusBasisPoints: context.artifacts.filter((item) => item.definition.statType === 'competition').reduce((sum, item) => sum + item.level * item.definition.baseBonus, 0),
      },
      currentBiomeId: player.currentBiomeId,
      equippedRodId: player.equippedRodId,
      selectedBaitId: player.selectedBaitId,
      equippedTitle: title ? {
        id: title.id,
        name: title.name,
        description: title.description,
        imagePath: title.imagePath,
        style: title.textColor ? {
          textColor: title.textColor,
          backgroundColor: title.backgroundColor,
          borderColor: title.borderColor,
          borderEffect: title.borderEffect,
        } : undefined,
      } : null,
      stats: context.stats,
      reincarnation: {
        round: context.reincarnation.round,
        points: {
          strength: context.reincarnation.strengthPoints,
          intelligence: context.reincarnation.intelligencePoints,
          luck: context.reincarnation.luckPoints,
          endurance: context.reincarnation.endurancePoints,
        },
      },
    },
    publicIdentity: {
      publicId: player.publicId,
      nickname: player.nickname,
      guildTag,
      level: player.level,
      avatar: avatar[0]
        ? { id: avatar[0].id, name: avatar[0].name, imagePath: avatar[0].imagePath, isActive: true }
        : { id: 'moonfall-scout', name: '溪谷巡游者', imagePath: '/fish/b_001_common_01.webp', isActive: true },
      equippedTitle: title
        ? { id: title.id, name: title.name, imagePath: title.imagePath, description: title.description }
        : null,
      nameStyle: {
        mode: player.nameStyleMode,
        colors: player.nameStyleColors ?? [],
        angle: player.nameStyleAngle ?? undefined,
      },
    },
    party,
    serverTime: new Date().toISOString(),
  };
}

export function nextLevelExp(level: number): number {
  return Math.floor(100 + 29.0908424 * Math.pow(level, 1.5614014));
}
