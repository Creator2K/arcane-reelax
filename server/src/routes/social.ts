import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { eq, and, sql, desc, asc } from 'drizzle-orm';
import { requireAuth } from '../services/auth.js';
import { AppError } from '../util/errors.js';
import { GUILD_CONFIG } from '../constants.js';
import { randomUUID } from 'node:crypto';

export async function registerSocialRoutes(app: FastifyInstance) {
  // ============ GUILDS ============
  app.get('/api/guilds/me', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const membership = (await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id)))[0];
    let guild = null;
    let membershipOut = null;
    if (membership) {
      const g = (await db.select().from(schema.guilds).where(eq(schema.guilds.id, membership.guildId)))[0];
      const memberCount = await db.select({ count: sql<number>`count(*)::int` }).from(schema.guildMembers).where(eq(schema.guildMembers.guildId, g.id));
      guild = { ...guildPublic(g), memberCount: Number(memberCount[0]?.count ?? 1) };
      membershipOut = {
        role: membership.role,
        joinedAt: membership.joinedAt.toISOString(),
        totalDonatedGold: membership.totalDonatedGold,
        totalTaxContributed: membership.totalTaxContributed,
      };
    }
    const pending = (await db.select().from(schema.guildApplications).where(and(
      eq(schema.guildApplications.playerId, player.id), eq(schema.guildApplications.status, 'pending'),
    )))[0] ?? null;

    return {
      guild,
      membership: membershipOut,
      pendingApplication: pending ? { id: pending.id, guildId: pending.guildId, message: pending.message, status: pending.status, createdAt: pending.createdAt.toISOString() } : null,
      recentTaxes: [],
      config: GUILD_CONFIG,
      serverTime: new Date().toISOString(),
    };
  });

  app.get('/api/guilds/search', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const q = String((req.query as any).q ?? '');
    const limit = Math.min(30, Number((req.query as any).limit ?? 30));
    const conds: any[] = [];
    if (q) conds.push(sql`(${schema.guilds.name} ilike ${'%' + q + '%'} OR ${schema.guilds.tag} ilike ${'%' + q + '%'})`);
    const rows = await db.select().from(schema.guilds).where(conds.length ? and(...conds) : undefined).orderBy(desc(schema.guilds.level)).limit(limit);
    const out = [];
    for (const g of rows) {
      const count = await db.select({ count: sql<number>`count(*)::int` }).from(schema.guildMembers).where(eq(schema.guildMembers.guildId, g.id));
      const leader = (await db.select().from(schema.players).where(eq(schema.players.id, g.leaderId)))[0];
      const joined = await db.select().from(schema.guildMembers).where(and(eq(schema.guildMembers.guildId, g.id), eq(schema.guildMembers.playerId, player.id)));
      const applied = await db.select().from(schema.guildApplications).where(and(
        eq(schema.guildApplications.guildId, g.id), eq(schema.guildApplications.playerId, player.id), eq(schema.guildApplications.status, 'pending'),
      ));
      out.push({
        ...guildPublic(g),
        memberCount: Number(count[0]?.count ?? 1),
        leader: leader ? { publicId: leader.publicId, nickname: leader.nickname, level: leader.level } : null,
        isMember: joined.length > 0,
        hasPendingApplication: applied.length > 0,
      });
    }
    return { guilds: out, nextCursor: null, serverTime: new Date().toISOString() };
  });

  app.get('/api/guilds/rankings', async (req, reply) => {
    const limit = Math.min(100, Number((req.query as any).limit ?? 50));
    const rows = await db.select({
      guildId: schema.guilds.id,
      name: schema.guilds.name,
      tag: schema.guilds.tag,
      level: schema.guilds.level,
      memberCount: sql<number>`(select count(*) from guild_members gm where gm.guild_id = guilds.id)::int`,
    }).from(schema.guilds).orderBy(desc(schema.guilds.level)).limit(limit);
    return { rankings: rows.map((r, i) => ({ rank: i + 1, ...r })), serverTime: new Date().toISOString() };
  });

  app.post('/api/guilds', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({ name: z.string().trim().min(2).max(24), tag: z.string().trim().min(1).max(8) }).parse(req.body as any);
    if (player.gold < GUILD_CONFIG.creationCost) throw new AppError('INSUFFICIENT_GOLD', '金币不足，创建公会需要 100,000 金币。');
    const existing = await db.select().from(schema.guilds).where(sql`(${schema.guilds.name} = ${body.name} OR ${schema.guilds.tag} = ${body.tag})`);
    if (existing.length) throw new AppError('GUILD_EXISTS', '公会名或简称已被使用。');
    const membership = (await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id)))[0];
    if (membership) throw new AppError('ALREADY_IN_GUILD', '你已在公会中。');

    const guild = (await db.insert(schema.guilds).values({
      name: body.name, tag: body.tag, leaderId: player.id, publicDescription: '暂无公开介绍',
    }).returning())[0];
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${GUILD_CONFIG.creationCost}` }).where(eq(schema.players.id, player.id));
      await tx.insert(schema.guildMembers).values({ guildId: guild.id, playerId: player.id, role: 'leader' });
      for (const type of ['experience', 'gold', 'luck', 'relic']) {
        await tx.insert(schema.guildTotems).values({ guildId: guild.id, type });
        await tx.insert(schema.guildBoosts).values({ guildId: guild.id, type });
      }
    });
    return { guild: guildPublic(guild), serverTime: new Date().toISOString() };
  });

  app.post('/api/guilds/:guildId/apply', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const guildId = String((req.params as any).guildId);
    const message = String((req.body as any)?.message ?? '').slice(0, 120);
    const guild = (await db.select().from(schema.guilds).where(eq(schema.guilds.id, guildId)))[0];
    if (!guild) throw new AppError('GUILD_NOT_FOUND', '公会不存在。');
    const member = await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id));
    if (member.length) throw new AppError('ALREADY_IN_GUILD', '你已在公会中。');
    const existing = await db.select().from(schema.guildApplications).where(and(
      eq(schema.guildApplications.guildId, guildId), eq(schema.guildApplications.playerId, player.id), eq(schema.guildApplications.status, 'pending'),
    ));
    if (existing.length) throw new AppError('ALREADY_APPLIED', '已提交申请，请等待审核。');
    await db.insert(schema.guildApplications).values({ guildId, playerId: player.id, message });
    return { success: true };
  });

  app.get('/api/guilds/me/applications', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const membership = (await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id)))[0];
    if (!membership) return { applications: [] };
    const rows = await db.select().from(schema.guildApplications).where(and(
      eq(schema.guildApplications.guildId, membership.guildId), eq(schema.guildApplications.status, 'pending'),
    )).orderBy(desc(schema.guildApplications.createdAt)).limit(50);
    const applicants = await db.select().from(schema.players);
    const playerMap = new Map(applicants.map((p) => [p.id, p]));
    return {
      applications: rows.map((a) => {
        const p = playerMap.get(a.playerId);
        return {
          id: a.id, playerId: a.playerId, nickname: p?.nickname ?? '未知', level: p?.level ?? 0,
          publicId: p?.publicId ?? 0, message: a.message, createdAt: a.createdAt.toISOString(),
        };
      }),
    };
  });

  app.post('/api/guilds/me/applications/:applicationId', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const applicationId = String((req.params as any).applicationId);
    const action = String((req.body as any)?.action ?? '');
    const membership = (await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id)))[0];
    if (!membership) throw new AppError('NOT_IN_GUILD', '你不在公会中。');
    const appRow = (await db.select().from(schema.guildApplications).where(eq(schema.guildApplications.id, applicationId)))[0];
    if (!appRow || appRow.guildId !== membership.guildId) throw new AppError('APPLICATION_NOT_FOUND', '申请不存在。');
    if (action === 'accept') {
      const memberCount = await db.select({ count: sql<number>`count(*)::int` }).from(schema.guildMembers).where(eq(schema.guildMembers.guildId, membership.guildId));
      const capacity = GUILD_CONFIG.baseMemberCapacity + (10 - 1) * 0;
      if (Number(memberCount[0]?.count ?? 0) >= capacity) throw new AppError('GUILD_FULL', '公会成员已满。');
      await db.transaction(async (tx) => {
        await tx.update(schema.guildApplications).set({ status: 'accepted', reviewedAt: new Date() }).where(eq(schema.guildApplications.id, applicationId));
        await tx.insert(schema.guildMembers).values({ guildId: membership.guildId, playerId: appRow.playerId, role: 'member' });
      });
    } else {
      await db.update(schema.guildApplications).set({ status: 'rejected', reviewedAt: new Date() }).where(eq(schema.guildApplications.id, applicationId));
    }
    return { success: true };
  });

  app.post('/api/guilds/me/leave', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const membership = (await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id)))[0];
    if (!membership) throw new AppError('NOT_IN_GUILD', '你不在公会中。');
    if (membership.role === 'leader') throw new AppError('LEADER_LEAVE', '会长需要先转让会长职位或解散公会。');
    await db.transaction(async (tx) => {
      await tx.delete(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id));
      await tx.delete(schema.guildApplications).where(eq(schema.guildApplications.playerId, player.id));
    });
    return { success: true };
  });

  app.post('/api/guilds/me/disband', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const membership = (await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id)))[0];
    if (!membership || membership.role !== 'leader') throw new AppError('NOT_LEADER', '只有会长可以解散公会。');
    await db.delete(schema.guilds).where(eq(schema.guilds.id, membership.guildId));
    return { success: true };
  });

  app.post('/api/guilds/me/transfer-leadership', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const targetPlayerId = String((req.body as any)?.playerId ?? '');
    const membership = (await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id)))[0];
    if (!membership || membership.role !== 'leader') throw new AppError('NOT_LEADER', '只有会长可以转让。');
    const target = (await db.select().from(schema.guildMembers).where(and(eq(schema.guildMembers.guildId, membership.guildId), eq(schema.guildMembers.playerId, targetPlayerId))))[0];
    if (!target) throw new AppError('MEMBER_NOT_FOUND', '目标成员不存在。');
    await db.transaction(async (tx) => {
      await tx.update(schema.guildMembers).set({ role: 'member' }).where(and(eq(schema.guildMembers.playerId, player.id), eq(schema.guildMembers.guildId, membership.guildId)));
      await tx.update(schema.guildMembers).set({ role: 'leader' }).where(and(eq(schema.guildMembers.playerId, targetPlayerId), eq(schema.guildMembers.guildId, membership.guildId)));
      await tx.update(schema.guilds).set({ leaderId: targetPlayerId }).where(eq(schema.guilds.id, membership.guildId));
    });
    return { success: true };
  });

  app.get('/api/guilds/me/members', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const membership = (await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id)))[0];
    if (!membership) return { members: [] };
    const rows = await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.guildId, membership.guildId));
    const players = await db.select().from(schema.players);
    const pMap = new Map(players.map((p) => [p.id, p]));
    return {
      members: rows.map((m) => {
        const p = pMap.get(m.playerId);
        return {
          playerId: m.playerId, publicId: p?.publicId ?? 0, nickname: p?.nickname ?? '未知',
          level: p?.level ?? 0, role: m.role, joinedAt: m.joinedAt.toISOString(),
          totalDonatedGold: m.totalDonatedGold, totalTaxContributed: m.totalTaxContributed,
        };
      }),
    };
  });

  app.get('/api/guilds/me/settings', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const membership = (await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id)))[0];
    if (!membership) return { config: GUILD_CONFIG, settings: { publicDescription: '', announcement: '', taxRatePercent: 0 } };
    const g = (await db.select().from(schema.guilds).where(eq(schema.guilds.id, membership.guildId)))[0];
    return {
      config: GUILD_CONFIG,
      settings: { publicDescription: g.publicDescription, announcement: g.announcement, taxRatePercent: g.taxRatePercent, nameStyle: { mode: g.nameStyleMode, colors: g.nameStyleColors ?? [] } },
    };
  });

  app.put('/api/guilds/me/settings', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({
      publicDescription: z.string().max(120).optional(),
      announcement: z.string().max(120).optional(),
      taxRatePercent: z.number().int().min(0).max(50).optional(),
    }).parse(req.body as any);
    const membership = (await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id)))[0];
    if (!membership) throw new AppError('NOT_IN_GUILD', '你不在公会中。');
    if (body.publicDescription !== undefined) {
      await db.update(schema.guilds).set({ publicDescription: body.publicDescription }).where(eq(schema.guilds.id, membership.guildId));
    }
    if (body.announcement !== undefined && membership.role !== 'member') {
      await db.update(schema.guilds).set({ announcement: body.announcement }).where(eq(schema.guilds.id, membership.guildId));
    }
    if (body.taxRatePercent !== undefined && membership.role !== 'member') {
      await db.update(schema.guilds).set({ taxRatePercent: body.taxRatePercent }).where(eq(schema.guilds.id, membership.guildId));
    }
    return { success: true };
  });

  app.put('/api/guilds/me/identity', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({ name: z.string().trim().min(2).max(24), tag: z.string().trim().min(1).max(8) }).parse(req.body as any);
    const membership = (await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id)))[0];
    if (!membership || membership.role === 'member') throw new AppError('PERMISSION_DENIED', '没有权限。');
    if (player.gold < GUILD_CONFIG.identityChangeCost) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${GUILD_CONFIG.identityChangeCost}` }).where(eq(schema.players.id, player.id));
      await tx.update(schema.guilds).set({ name: body.name, tag: body.tag }).where(eq(schema.guilds.id, membership.guildId));
    });
    return { success: true };
  });

  app.put('/api/guilds/me/name-style', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({ mode: z.enum(['default', 'solid', 'gradient']), color: z.string().optional(), colors: z.array(z.string()).max(2).optional() }).parse(req.body as any);
    const membership = (await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id)))[0];
    if (!membership || membership.role === 'member') throw new AppError('PERMISSION_DENIED', '没有权限。');
    const cost = body.mode === 'gradient' ? GUILD_CONFIG.nameStyleGradientBaseCost + (body.colors?.length === 2 ? GUILD_CONFIG.nameStyleGradientAdditionalColorCost : 0) : body.mode === 'solid' ? GUILD_CONFIG.nameStyleSolidCost : 0;
    if (player.gold < cost) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${cost}` }).where(eq(schema.players.id, player.id));
      await tx.update(schema.guilds).set({
        nameStyleMode: body.mode,
        nameStyleColors: body.mode === 'default' ? [] : body.mode === 'gradient' ? (body.colors ?? []) : body.color ? [body.color] : [],
      }).where(eq(schema.guilds.id, membership.guildId));
      await tx.insert(schema.guildNameStyleLogs).values({ guildId: membership.guildId, mode: body.mode, colors: body.mode === 'default' ? [] : body.mode === 'gradient' ? (body.colors ?? []) : body.color ? [body.color] : [], costGold: cost });
    });
    return { success: true };
  });

  app.get('/api/guilds/me/totems', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const membership = (await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id)))[0];
    if (!membership) return { totems: [] };
    const rows = await db.select().from(schema.guildTotems).where(eq(schema.guildTotems.guildId, membership.guildId));
    return { totems: rows.map(totemPublic) };
  });

  app.post('/api/guilds/me/totems/:totemId/donate', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const totemId = String((req.params as any).totemId);
    const gold = Math.max(1, Number((req.body as any)?.amount ?? (req.body as any)?.gold ?? 0));
    if (player.gold < gold) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    const totem = (await db.select().from(schema.guildTotems).where(eq(schema.guildTotems.id, totemId)))[0];
    if (!totem) throw new AppError('TOTEM_NOT_FOUND', '图腾不存在。');
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${gold}` }).where(eq(schema.players.id, player.id));
      await tx.update(schema.guildTotems).set({ donatedGold: totem.donatedGold + gold }).where(eq(schema.guildTotems.id, totemId));
      await tx.update(schema.guildMembers).set({ totalDonatedGold: sql`${schema.guildMembers.totalDonatedGold} + ${gold}` }).where(eq(schema.guildMembers.playerId, player.id));
    });
    // auto-level check
    const updated = (await db.select().from(schema.guildTotems).where(eq(schema.guildTotems.id, totemId)))[0];
    while (updated.donatedGold >= levelUpCostFor(updated.level) && updated.level < 10) {
      await db.update(schema.guildTotems).set({ level: updated.level + 1, donatedGold: updated.donatedGold - levelUpCostFor(updated.level) }).where(eq(schema.guildTotems.id, totemId));
    }
    return { success: true, totem: totemPublic((await db.select().from(schema.guildTotems).where(eq(schema.guildTotems.id, totemId)))[0]) };
  });

  app.post('/api/guilds/me/totems/:totemId/activate', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const totemId = String((req.params as any).totemId);
    const hours = Math.min(24, Math.max(1, Number((req.body as any)?.hours ?? 1)));
    const totem = (await db.select().from(schema.guildTotems).where(eq(schema.guildTotems.id, totemId)))[0];
    if (!totem) throw new AppError('TOTEM_NOT_FOUND', '图腾不存在。');
    const cost = totem.activationCostGold * hours;
    if (player.gold < cost) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${cost}` }).where(eq(schema.players.id, player.id));
      await tx.update(schema.guildTotems).set({
        activatedUntil: new Date(Math.max(Date.now(), totem.activatedUntil?.getTime() ?? 0) + hours * 3600 * 1000),
      }).where(eq(schema.guildTotems.id, totemId));
    });
    return { success: true };
  });

  app.post('/api/guilds/me/boosts', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({ type: z.string(), units: z.number().int().min(1).max(48) }).parse(req.body as any);
    const membership = (await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id)))[0];
    if (!membership) throw new AppError('NOT_IN_GUILD', '你不在公会中。');
    const cost = GUILD_CONFIG.boostUnitCost * body.units;
    if (player.gold < cost) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    const boost = (await db.select().from(schema.guildBoosts).where(and(
      eq(schema.guildBoosts.guildId, membership.guildId), eq(schema.guildBoosts.type, body.type),
    )))[0];
    const now = Date.now();
    const base = Math.max(now, boost?.endsAt?.getTime() ?? 0);
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${cost}` }).where(eq(schema.players.id, player.id));
      await tx.insert(schema.guildBoosts).values({
        guildId: membership.guildId, type: body.type, isActive: true,
        startsAt: new Date(now), endsAt: new Date(base + body.units * GUILD_CONFIG.boostDurationMinutes * 60 * 1000),
        purchasedUnits: body.units,
      }).onConflictDoUpdate({
        target: [schema.guildBoosts.guildId, schema.guildBoosts.type],
        set: { isActive: true, startsAt: new Date(now), endsAt: new Date(base + body.units * GUILD_CONFIG.boostDurationMinutes * 60 * 1000), purchasedUnits: (boost?.purchasedUnits ?? 0) + body.units },
      });
    });
    return { success: true };
  });

  app.post('/api/guilds/me/donations', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const gold = Math.max(1, Number((req.body as any)?.gold ?? 0));
    if (player.gold < gold) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    const membership = (await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id)))[0];
    if (!membership) throw new AppError('NOT_IN_GUILD', '你不在公会中。');
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${gold}` }).where(eq(schema.players.id, player.id));
      await tx.update(schema.guilds).set({ treasuryGold: sql`${schema.guilds.treasuryGold} + ${gold}` }).where(eq(schema.guilds.id, membership.guildId));
      await tx.update(schema.guildMembers).set({ totalDonatedGold: sql`${schema.guildMembers.totalDonatedGold} + ${gold}` }).where(eq(schema.guildMembers.playerId, player.id));
    });
    return { success: true };
  });

  app.get('/api/guilds/me/treasury', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const membership = (await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id)))[0];
    if (!membership) throw new AppError('NOT_IN_GUILD', '你不在公会中。');
    const g = (await db.select().from(schema.guilds).where(eq(schema.guilds.id, membership.guildId)))[0];
    return { treasuryGold: g.treasuryGold, taxRatePercent: g.taxRatePercent, memberCount: (await db.select({ count: sql<number>`count(*)::int` }).from(schema.guildMembers).where(eq(schema.guildMembers.guildId, g.id)))[0]?.count ?? 0 };
  });

  app.get('/api/guilds/me/contributions', async (req, reply) => { await requireAuth(req, reply); return { items: [], nextCursor: null, serverTime: new Date().toISOString() }; });
  app.get('/api/guilds/me/boosts', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const membership = (await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id)))[0];
    if (!membership) return { boosts: [], items: [], serverTime: new Date().toISOString() };
    const rows = await db.select().from(schema.guildBoosts).where(eq(schema.guildBoosts.guildId, membership.guildId));
    return { boosts: rows.map((row) => ({ biomeId: player.currentBiomeId, type: row.type, isActive: row.isActive, startsAt: row.startsAt?.toISOString() ?? null, endsAt: row.endsAt?.toISOString() ?? null })), items: [], config: GUILD_CONFIG, serverTime: new Date().toISOString() };
  });

  app.get('/api/guilds/:publicId', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const publicId = Number((req.params as any).publicId);
    const guilds = await db.select().from(schema.guilds);
    const guild = guilds.find((item) => guildNumericId(item.id) === publicId);
    if (!guild) throw new AppError('GUILD_NOT_FOUND', '公会不存在。', 404);
    const [members, leader] = await Promise.all([
      db.select().from(schema.guildMembers).where(eq(schema.guildMembers.guildId, guild.id)),
      db.select().from(schema.players).where(eq(schema.players.id, guild.leaderId)),
    ]);
    return {
      ...guildPublic(guild),
      memberCount: members.length,
      memberCapacity: GUILD_CONFIG.baseMemberCapacity,
      experienceToNextLevel: levelUpCostFor(guild.level + 1),
      recruitmentMode: 'open',
      minimumApplicationLevel: 0,
      leader: leader[0] ? guildIdentity(leader[0]) : null,
      isMember: members.some((member) => member.playerId === player.id),
      serverTime: new Date().toISOString(),
    };
  });

  app.get('/api/guilds/:publicId/members', async (req, reply) => {
    await requireAuth(req, reply);
    const publicId = Number((req.params as any).publicId);
    const guilds = await db.select().from(schema.guilds);
    const guild = guilds.find((item) => guildNumericId(item.id) === publicId);
    if (!guild) throw new AppError('GUILD_NOT_FOUND', '公会不存在。', 404);
    const [members, players] = await Promise.all([db.select().from(schema.guildMembers).where(eq(schema.guildMembers.guildId, guild.id)), db.select().from(schema.players)]);
    const playerMap = new Map(players.map((item) => [item.id, item]));
    return { items: members.map((member) => { const owner = playerMap.get(member.playerId); return owner ? { membershipId: member.playerId, identity: guildIdentity(owner), role: member.role, joinedAt: member.joinedAt.toISOString(), contribution: member.totalDonatedGold } : null; }).filter(Boolean), nextCursor: null, serverTime: new Date().toISOString() };
  });

  app.get('/api/guilds/:publicId/tournament-history', async (req, reply) => { await requireAuth(req, reply); return { items: [], nextCursor: null, serverTime: new Date().toISOString() }; });
  app.get('/api/guilds/:publicId/trophies', async (req, reply) => { await requireAuth(req, reply); return { trophies: [], items: [], serverTime: new Date().toISOString() }; });
  app.get('/api/guilds/me/activities', async (req, reply) => { await requireAuth(req, reply); return { items: [], nextCursor: null, serverTime: new Date().toISOString() }; });

  app.post('/api/guilds/me/applications/:applicationId/approve', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const membership = (await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id)))[0];
    if (!membership || membership.role === 'member') throw new AppError('PERMISSION_DENIED', '没有审批权限。');
    const application = (await db.select().from(schema.guildApplications).where(eq(schema.guildApplications.id, String((req.params as any).applicationId))))[0];
    if (!application) throw new AppError('APPLICATION_NOT_FOUND', '申请不存在。');
    await db.transaction(async (tx) => {
      await tx.update(schema.guildApplications).set({ status: 'approved' }).where(eq(schema.guildApplications.id, application.id));
      await tx.insert(schema.guildMembers).values({ guildId: membership.guildId, playerId: application.playerId, role: 'member' }).onConflictDoNothing();
    });
    return { success: true };
  });
  app.post('/api/guilds/me/applications/:applicationId/reject', async (req, reply) => {
    await requireAuth(req, reply);
    const applicationId = String((req.params as any).applicationId);
    await db.update(schema.guildApplications).set({ status: 'rejected' }).where(eq(schema.guildApplications.id, applicationId));
    return { success: true };
  });

  app.patch('/api/guilds/me/members/:membershipId', async (req, reply) => {
    await requireAuth(req, reply);
    const membership = (await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, String((req.params as any).membershipId))))[0];
    if (!membership) throw new AppError('MEMBER_NOT_FOUND', '成员不存在。');
    const role = z.enum(['member', 'officer']).parse((req.body as any)?.role);
    await db.update(schema.guildMembers).set({ role }).where(eq(schema.guildMembers.playerId, membership.playerId));
    return { success: true };
  });
  app.patch('/api/guilds/me/members/:membershipId/role', async (req, reply) => {
    const role = z.enum(['member', 'officer']).parse((req.body as any)?.role);
    await db.update(schema.guildMembers).set({ role }).where(eq(schema.guildMembers.playerId, String((req.params as any).membershipId)));
    return { success: true };
  });
  app.delete('/api/guilds/me/members/:membershipId', async (req, reply) => {
    await db.delete(schema.guildMembers).where(eq(schema.guildMembers.playerId, String((req.params as any).membershipId)));
    return { success: true };
  });
  app.post('/api/guilds/me/boosts/:biomeId', async (req, reply) => { await requireAuth(req, reply); return { success: true, serverTime: new Date().toISOString() }; });
  app.post('/api/guilds/me/totems/:totemId/upgrade', async (req, reply) => {
    await requireAuth(req, reply);
    const totemId = String((req.params as any).totemId);
    const totem = (await db.select().from(schema.guildTotems).where(eq(schema.guildTotems.id, totemId)))[0];
    if (!totem) throw new AppError('TOTEM_NOT_FOUND', '图腾不存在。');
    await db.update(schema.guildTotems).set({ level: totem.level + 1 }).where(eq(schema.guildTotems.id, totem.id));
    return { success: true };
  });

  // ============ PARTY BOATS ============
  app.get('/api/party-boats/crowdfundings/current', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const member = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)))[0];
    const boat = member ? (await db.select().from(schema.partyBoats).where(eq(schema.partyBoats.id, member.boatId)))[0] : null;
    return { current: boat?.status === 'funding' ? await currentCrowdfunding(boat.id) : null, expansion: null, disbandVote: null, serverTime: new Date().toISOString() };
  });

  app.get('/api/party-boats/overview', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const [defs, myBoat] = await Promise.all([
      db.select().from(schema.boatDefinitions).orderBy(schema.boatDefinitions.orderIndex),
      db.select().from(schema.partyBoatMembers).innerJoin(schema.partyBoats, eq(schema.partyBoatMembers.boatId, schema.partyBoats.id)).where(eq(schema.partyBoatMembers.playerId, player.id)),
    ]);
    const activeBoats = await db.select().from(schema.partyBoats).where(eq(schema.partyBoats.status, 'active'));
    const boat = myBoat[0]?.party_boats ?? null;
    let myBoatOut = null;
    if (boat) {
      const members = await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.boatId, boat.id));
      const def = defs.find((d) => d.id === boat.boatDefinitionId);
      myBoatOut = {
        id: boat.id,
        name: boat.name,
        boatDefinitionId: boat.boatDefinitionId,
        boatName: def?.name ?? '',
        capacity: def?.capacity ?? 3,
        status: boat.status,
        visibility: boat.visibility,
        joinCode: boat.joinCode,
        biomeId: boat.biomeId,
        role: myBoat[0].party_boat_members.role,
        memberCount: members.length,
        rentalEndsAt: boat.rentalEndsAt?.toISOString() ?? null,
        maintenanceDueAt: boat.maintenanceDueAt?.toISOString() ?? null,
        isPermanent: boat.isPermanent,
      };
    }
    return {
      catalog: defs.map((d) => ({
        id: d.id, name: d.name, capacity: d.capacity,
        hourlyRentalGold: d.hourlyRentGold, dailyRentalGold: d.dailyRentGold,
        purchaseGold: d.permanentPriceGold, maintenanceGold: d.maintenanceFourteenDayGold,
        maximumPartyBonusBasisPoints: d.crewExperienceBonusBasisPoints,
        imagePath: d.imagePath || '/party-boats/reedwake-dinghy.webp',
      })),
      gold: player.gold,
      relics: player.relics,
      nextRenameRelicCost: null,
      ownership: myBoatOut ? {
        id: myBoatOut.id,
        name: myBoatOut.name,
        boatDefinitionId: myBoatOut.boatDefinitionId,
        boatName: myBoatOut.boatName,
        capacity: myBoatOut.capacity,
        status: myBoatOut.status,
        visibility: myBoatOut.visibility,
        joinCode: myBoatOut.joinCode,
        biomeId: myBoatOut.biomeId,
        rentalEndsAt: myBoatOut.rentalEndsAt,
        maintenanceDueAt: myBoatOut.maintenanceDueAt,
        isPermanent: myBoatOut.isPermanent,
        treasuryGold: boat?.treasuryGold ?? 0,
        recycleGold: Math.floor((defs.find((item) => item.id === myBoatOut.boatDefinitionId)?.permanentPriceGold ?? 0) * 0.5),
      } : null,
      party: {
        isInParty: !!myBoatOut,
        role: myBoatOut?.role ?? null,
        canChangeBoatBiome: myBoatOut?.role === 'captain' || myBoatOut?.role === 'helm',
        status: myBoatOut ? 'active' : null,
        source: null,
        boatDefinitionId: myBoatOut?.boatDefinitionId ?? null,
        boatName: myBoatOut?.boatName ?? null,
        visibility: myBoatOut?.visibility ?? null,
        boatBiomeId: myBoatOut?.biomeId ?? null,
        rentalEndsAt: myBoatOut?.rentalEndsAt ?? null,
        maintenanceDueAt: myBoatOut?.maintenanceDueAt ?? null,
        rosterVersion: null,
        biomeVersion: null,
        identityVersion: null,
      },
      crew: boat ? await buildCrewSnapshot(boat, defs, player.id) : null,
      serverTime: new Date().toISOString(),
    };
  });

  app.post('/api/party-boats/rent', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({ boatDefinitionId: z.string(), durationHours: z.number().int().min(1).max(720).optional(), billingUnit: z.enum(['hour', 'day']).optional().default('hour'), quantity: z.number().int().min(1).max(30).optional().default(1), maxGoldCost: z.number().int().positive().optional() }).parse(req.body as any);
    const def = (await db.select().from(schema.boatDefinitions).where(eq(schema.boatDefinitions.id, body.boatDefinitionId)))[0];
    if (!def) throw new AppError('BOAT_NOT_FOUND', '船只不存在。');
    const durationHours = body.durationHours ?? (body.billingUnit === 'day' ? body.quantity * 24 : body.quantity);
    const cost = body.billingUnit === 'day' ? def.dailyRentGold * body.quantity : def.hourlyRentGold * body.quantity;
    if (body.maxGoldCost !== undefined && cost > body.maxGoldCost) throw new AppError('PRICE_CHANGED', '租金价格已经变化，请重新确认。');
    if (player.gold < cost) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    const member = await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id));
    if (member.length) throw new AppError('ALREADY_IN_PARTY', '你已在船队中。');

    const boat = (await db.insert(schema.partyBoats).values({
      captainId: player.id,
      name: `${player.nickname}的船`,
      boatDefinitionId: body.boatDefinitionId,
      joinCode: genCode(),
      rentalEndsAt: new Date(Date.now() + durationHours * 3600 * 1000),
      maintenanceDueAt: new Date(Date.now() + 14 * 24 * 3600 * 1000),
      upkeepPaidAt: new Date(),
    }).returning())[0];
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${cost}` }).where(eq(schema.players.id, player.id));
      await tx.insert(schema.partyBoatMembers).values({ boatId: boat.id, playerId: player.id, role: 'captain' });
    });
    return { success: true, boat: { id: boat.id, name: boat.name, joinCode: boat.joinCode } };
  });

  app.post('/api/party-boats/launch', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({ boatDefinitionId: z.string() }).parse(req.body as any);
    const def = (await db.select().from(schema.boatDefinitions).where(eq(schema.boatDefinitions.id, body.boatDefinitionId)))[0];
    if (!def) throw new AppError('BOAT_NOT_FOUND', '船只不存在。');
    if (player.gold < def.permanentPriceGold) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    const member = await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id));
    if (member.length) throw new AppError('ALREADY_IN_PARTY', '你已在船队中。');
    const boat = (await db.insert(schema.partyBoats).values({
      captainId: player.id,
      name: `${player.nickname}的船`,
      boatDefinitionId: body.boatDefinitionId,
      joinCode: genCode(),
      isPermanent: true,
      maintenanceDueAt: new Date(Date.now() + 14 * 24 * 3600 * 1000),
      upkeepPaidAt: new Date(),
    }).returning())[0];
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${def.permanentPriceGold}` }).where(eq(schema.players.id, player.id));
      await tx.insert(schema.partyBoatMembers).values({ boatId: boat.id, playerId: player.id, role: 'captain' });
    });
    return { success: true, boat: { id: boat.id, name: boat.name, joinCode: boat.joinCode } };
  });

  app.post('/api/party-boats/purchase', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({ boatDefinitionId: z.string(), maxGoldCost: z.number().int().positive().optional() }).parse(req.body as any);
    const def = (await db.select().from(schema.boatDefinitions).where(eq(schema.boatDefinitions.id, body.boatDefinitionId)))[0];
    if (!def) throw new AppError('BOAT_NOT_FOUND', '船只不存在。');
    if (body.maxGoldCost !== undefined && def.permanentPriceGold > body.maxGoldCost) throw new AppError('PRICE_CHANGED', '船价已经变化，请重新确认。');
    if (player.gold < def.permanentPriceGold) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    const member = await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id));
    if (member.length) throw new AppError('ALREADY_IN_PARTY', '你已在船队中。');
    const boat = (await db.insert(schema.partyBoats).values({
      captainId: player.id, name: `${player.nickname}的船`, boatDefinitionId: def.id,
      joinCode: genCode(), isPermanent: true, visibility: 'public',
      maintenanceDueAt: new Date(Date.now() + 14 * 24 * 3600 * 1000), upkeepPaidAt: new Date(),
    }).returning())[0];
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${def.permanentPriceGold}` }).where(eq(schema.players.id, player.id));
      await tx.insert(schema.partyBoatMembers).values({ boatId: boat.id, playerId: player.id, role: 'captain' });
    });
    return { success: true, boat: { id: boat.id, name: boat.name, joinCode: boat.joinCode } };
  });

  app.post('/api/party-boats/recycle', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const member = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)))[0];
    if (!member || member.role !== 'captain') throw new AppError('NOT_CAPTAIN', '只有船长可以回收船只。');
    const boat = (await db.select().from(schema.partyBoats).where(eq(schema.partyBoats.id, member.boatId)))[0];
    const def = (await db.select().from(schema.boatDefinitions).where(eq(schema.boatDefinitions.id, boat.boatDefinitionId)))[0];
    const refund = Math.floor((def?.permanentPriceGold ?? 0) * 0.5);
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} + ${refund}` }).where(eq(schema.players.id, player.id));
      await tx.delete(schema.partyBoats).where(eq(schema.partyBoats.id, boat.id));
    });
    return { success: true, refundGold: refund };
  });

  app.post('/api/party-boats/visibility', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const visibility = z.enum(['public', 'private']).parse((req.body as any)?.visibility);
    const member = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)))[0];
    if (!member || member.role !== 'captain') throw new AppError('NOT_CAPTAIN', '只有船长可以修改可见性。');
    await db.update(schema.partyBoats).set({ visibility }).where(eq(schema.partyBoats.id, member.boatId));
    return { success: true, visibility };
  });

  app.post('/api/party-boats/name', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const name = z.string().trim().min(2).max(24).parse((req.body as any)?.name);
    const member = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)))[0];
    if (!member || member.role !== 'captain') throw new AppError('NOT_CAPTAIN', '只有船长可以修改船名。');
    await db.update(schema.partyBoats).set({ name }).where(eq(schema.partyBoats.id, member.boatId));
    return { success: true, name };
  });

  app.post('/api/party-boats/join-code/rotate', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const member = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)))[0];
    if (!member || member.role !== 'captain') throw new AppError('NOT_CAPTAIN', '只有船长可以轮换邀请码。');
    const joinCode = genCode();
    await db.update(schema.partyBoats).set({ joinCode }).where(eq(schema.partyBoats.id, member.boatId));
    return { success: true, joinCode };
  });

  app.post('/api/party-boats/rental/end', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const member = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)))[0];
    if (!member || member.role !== 'captain') throw new AppError('NOT_CAPTAIN', '只有船长可以退租。');
    await db.delete(schema.partyBoats).where(eq(schema.partyBoats.id, member.boatId));
    return { success: true };
  });

  app.post('/api/party-boats/rental/buyout', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const member = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)))[0];
    if (!member || member.role !== 'captain') throw new AppError('NOT_CAPTAIN', '只有船长可以买断。');
    const boat = (await db.select().from(schema.partyBoats).where(eq(schema.partyBoats.id, member.boatId)))[0];
    const def = (await db.select().from(schema.boatDefinitions).where(eq(schema.boatDefinitions.id, boat.boatDefinitionId)))[0];
    const maxGoldCost = Number((req.body as any)?.maxGoldCost ?? def.permanentPriceGold);
    if (boat.treasuryGold < def.permanentPriceGold || def.permanentPriceGold > maxGoldCost) throw new AppError('INSUFFICIENT_TREASURY', '船队金库余额不足。');
    await db.update(schema.partyBoats).set({
      treasuryGold: sql`${schema.partyBoats.treasuryGold} - ${def.permanentPriceGold}`,
      isPermanent: true, rentalEndsAt: null,
      maintenanceDueAt: new Date(Date.now() + 14 * 24 * 3600 * 1000), upkeepPaidAt: new Date(),
    }).where(eq(schema.partyBoats.id, boat.id));
    return { success: true };
  });

  app.post('/api/party-boats/current-biome', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const biomeId = z.string().min(1).max(16).parse((req.body as any)?.biomeId);
    const previousBiomeId = player.currentBiomeId;
    const member = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)))[0];
    const boat = member ? (await db.select().from(schema.partyBoats).where(eq(schema.partyBoats.id, member.boatId)))[0] : null;
    const previousBoatBiomeId = boat?.biomeId ?? null;
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ currentBiomeId: biomeId }).where(eq(schema.players.id, player.id));
      if (boat) await tx.update(schema.partyBoats).set({ biomeId }).where(eq(schema.partyBoats.id, boat.id));
    });
    return { previousBiomeId, currentBiomeId: biomeId, changed: previousBiomeId !== biomeId, previousBoatBiomeId, currentBoatBiomeId: boat ? biomeId : null, movedCount: boat ? 1 : 0, skippedLockedCount: 0, skippedAwayCount: 0, serverTime: new Date().toISOString() };
  });

  app.get('/api/party-boats/public', async (req, reply) => {
    await requireAuth(req, reply);
    return { items: [], nextCursor: null, serverTime: new Date().toISOString() };
  });

  app.get('/api/party-boats/invitations', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const rows = await db.select().from(schema.partyBoatInvitations).where(eq(schema.partyBoatInvitations.playerId, player.id));
    return { items: rows.map((row) => ({ id: row.id, status: 'pending', createdAt: row.createdAt.toISOString(), expiresAt: new Date(row.createdAt.getTime() + 86400_000).toISOString() })), nextCursor: null, serverTime: new Date().toISOString() };
  });

  app.get('/api/party-boats/player-search', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const q = String((req.query as any)?.q ?? '').trim();
    if (q.length < 2) return { items: [], serverTime: new Date().toISOString() };
    const rows = await db.select().from(schema.players).where(sql`(${schema.players.nickname} ilike ${'%' + q + '%'} OR CAST(${schema.players.publicId} AS text) = ${q})`).limit(10);
    return { items: rows.filter((row) => row.id !== player.id).map((row) => ({ publicId: row.publicId, nickname: row.nickname, level: row.level, guildTag: null, equippedTitle: null, nameStyle: { mode: row.nameStyleMode, colors: row.nameStyleColors ?? [], angle: row.nameStyleAngle ?? undefined } })), serverTime: new Date().toISOString() };
  });

  app.post('/api/party-boats/invitations', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const publicId = Number((req.body as any)?.playerPublicId);
    const invitee = (await db.select().from(schema.players).where(eq(schema.players.publicId, publicId)))[0];
    const member = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)))[0];
    if (!invitee) throw new AppError('PLAYER_NOT_FOUND', '玩家不存在。');
    if (!member || member.role !== 'captain') throw new AppError('NOT_CAPTAIN', '只有船长可以邀请玩家。');
    const existing = await db.select().from(schema.partyBoatInvitations).where(and(eq(schema.partyBoatInvitations.boatId, member.boatId), eq(schema.partyBoatInvitations.playerId, invitee.id)));
    if (!existing.length) await db.insert(schema.partyBoatInvitations).values({ boatId: member.boatId, playerId: invitee.id });
    return { success: true };
  });

  for (const action of ['accept', 'reject', 'cancel'] as const) {
    app.post(`/api/party-boats/invitations/:invitationId/${action}`, async (req, reply) => {
      const player = await requireAuth(req, reply);
      const id = String((req.params as any).invitationId);
      const invitation = (await db.select().from(schema.partyBoatInvitations).where(eq(schema.partyBoatInvitations.id, id)))[0];
      if (!invitation) throw new AppError('INVITATION_NOT_FOUND', '邀请不存在。');
      if (action === 'accept') {
        if (invitation.playerId !== player.id) throw new AppError('INVITATION_NOT_FOUND', '邀请不存在。');
        const existing = await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id));
        if (existing.length) throw new AppError('ALREADY_IN_PARTY', '你已在船队中。');
        await db.transaction(async (tx) => {
          await tx.insert(schema.partyBoatMembers).values({ boatId: invitation.boatId, playerId: player.id, role: 'crew' });
          await tx.delete(schema.partyBoatInvitations).where(eq(schema.partyBoatInvitations.id, invitation.id));
        });
      } else {
        await db.delete(schema.partyBoatInvitations).where(eq(schema.partyBoatInvitations.id, invitation.id));
      }
      return { success: true };
    });
  }

  app.get('/api/party-boats/crowdfundings/public', async (req, reply) => {
    await requireAuth(req, reply);
    return { items: [], nextCursor: null, serverTime: new Date().toISOString() };
  });

  app.post('/api/party-boats/crowdfundings/preview-code', async (req, reply) => {
    await requireAuth(req, reply);
    const code = String((req.body as any)?.code ?? '').trim();
    if (!code) throw new AppError('INVALID_CODE', '请输入合建邀请码。');
    throw new AppError('CROWDFUNDING_NOT_FOUND', '没有找到对应的合建项目。', 404);
  });

  app.post('/api/party-boats/crowdfundings/join-by-code', async (req, reply) => {
    await requireAuth(req, reply);
    throw new AppError('CROWDFUNDING_NOT_FOUND', '没有找到对应的合建项目。', 404);
  });

  app.post('/api/party-boats/crowdfundings', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({ boatDefinitionId: z.string(), visibility: z.enum(['public', 'private']).default('public'), maxGoldCost: z.number().int().positive().optional() }).parse(req.body as any);
    const def = (await db.select().from(schema.boatDefinitions).where(eq(schema.boatDefinitions.id, body.boatDefinitionId)))[0];
    if (!def) throw new AppError('BOAT_NOT_FOUND', '船只不存在。');
    const member = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)))[0];
    if (member) throw new AppError('ALREADY_IN_PARTY', '你已在船队中。');
    const participantGold = Math.ceil(def.permanentPriceGold / Math.max(2, def.capacity));
    if (body.maxGoldCost !== undefined && participantGold > body.maxGoldCost) throw new AppError('PRICE_CHANGED', '合建价格已经变化，请重新确认。');
    if (player.gold < participantGold) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    const boat = (await db.insert(schema.partyBoats).values({
      captainId: player.id, name: `${player.nickname}的合建船`, boatDefinitionId: def.id, status: 'funding', visibility: body.visibility,
      joinCode: genCode(), crowdfundingGold: participantGold, crowdfundingTarget: def.permanentPriceGold,
    }).returning())[0];
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${participantGold}` }).where(eq(schema.players.id, player.id));
      await tx.insert(schema.partyBoatMembers).values({ boatId: boat.id, playerId: player.id, role: 'captain' });
      await tx.insert(schema.partyBoatCrowdfundingContributions).values({ boatId: boat.id, playerId: player.id, gold: participantGold });
    });
    return { success: true, crowdfunding: await currentCrowdfunding(boat.id), serverTime: new Date().toISOString() };
  });

  app.post('/api/party-boats/crowdfundings/current/cancel', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const member = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)))[0];
    if (!member || member.role !== 'captain') throw new AppError('NOT_CAPTAIN', '只有船长可以取消合建。');
    const boat = (await db.select().from(schema.partyBoats).where(eq(schema.partyBoats.id, member.boatId)))[0];
    if (!boat || boat.status !== 'funding') throw new AppError('CROWDFUNDING_NOT_FOUND', '当前没有进行中的合建。');
    const contributions = await db.select().from(schema.partyBoatCrowdfundingContributions).where(eq(schema.partyBoatCrowdfundingContributions.boatId, boat.id));
    await db.transaction(async (tx) => {
      for (const contribution of contributions) {
        await tx.update(schema.players).set({ gold: sql`${schema.players.gold} + ${contribution.gold}` }).where(eq(schema.players.id, contribution.playerId));
      }
      await tx.delete(schema.partyBoats).where(eq(schema.partyBoats.id, boat.id));
    });
    return { success: true, current: null, expansion: null, disbandVote: null, serverTime: new Date().toISOString() };
  });

  app.post('/api/party-boats/crowdfundings/current/disband-vote', async (req, reply) => {
    await requireAuth(req, reply);
    return { success: true, current: null, expansion: null, disbandVote: null, serverTime: new Date().toISOString() };
  });
  app.post('/api/party-boats/crowdfundings/current/upgrade', async (req, reply) => {
    await requireAuth(req, reply);
    return { success: true, current: null, expansion: null, disbandVote: null, serverTime: new Date().toISOString() };
  });

  app.post('/api/party-boats/crowdfundings/:crowdfundingId/join', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const boat = (await db.select().from(schema.partyBoats).where(eq(schema.partyBoats.id, String((req.params as any).crowdfundingId))))[0];
    if (!boat || boat.status !== 'funding') throw new AppError('CROWDFUNDING_NOT_FOUND', '合建项目不存在。');
    const def = (await db.select().from(schema.boatDefinitions).where(eq(schema.boatDefinitions.id, boat.boatDefinitionId)))[0];
    const participantGold = Math.ceil(Number(boat.crowdfundingTarget) / Math.max(2, def?.capacity ?? 3));
    if (Number((req.body as any)?.maxGoldCost ?? participantGold) < participantGold) throw new AppError('PRICE_CHANGED', '合建价格已经变化。');
    if (player.gold < participantGold) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    const existing = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)))[0];
    if (existing) throw new AppError('ALREADY_IN_PARTY', '你已在船队中。');
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${participantGold}` }).where(eq(schema.players.id, player.id));
      await tx.update(schema.partyBoats).set({ crowdfundingGold: sql`${schema.partyBoats.crowdfundingGold} + ${participantGold}` }).where(eq(schema.partyBoats.id, boat.id));
      await tx.insert(schema.partyBoatMembers).values({ boatId: boat.id, playerId: player.id, role: 'crew' });
      await tx.insert(schema.partyBoatCrowdfundingContributions).values({ boatId: boat.id, playerId: player.id, gold: participantGold });
    });
    const count = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.boatId, boat.id))).length;
    if (count >= (def?.capacity ?? 3)) await db.update(schema.partyBoats).set({ status: 'active', isPermanent: true, maintenanceDueAt: new Date(Date.now() + 14 * 86400_000) }).where(eq(schema.partyBoats.id, boat.id));
    return { success: true, serverTime: new Date().toISOString() };
  });

  app.post('/api/party-boats/public/:boatId/join', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const boat = (await db.select().from(schema.partyBoats).where(eq(schema.partyBoats.id, String((req.params as any).boatId))))[0];
    if (!boat || boat.visibility !== 'public' || boat.status !== 'active') throw new AppError('BOAT_NOT_FOUND', '公开船只不存在。');
    await db.insert(schema.partyBoatMembers).values({ boatId: boat.id, playerId: player.id, role: 'crew' }).onConflictDoNothing();
    return { success: true };
  });

  app.patch('/api/party-boats/members/:publicId/role', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const captain = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)))[0];
    if (!captain || captain.role !== 'captain') throw new AppError('NOT_CAPTAIN', '只有船长可以调整身份。');
    const target = (await db.select().from(schema.players).where(eq(schema.players.publicId, Number((req.params as any).publicId))))[0];
    const role = z.enum(['crew', 'helmsman']).parse((req.body as any)?.role);
    if (!target) throw new AppError('PLAYER_NOT_FOUND', '玩家不存在。');
    await db.update(schema.partyBoatMembers).set({ role: role === 'helmsman' ? 'helm' : 'crew' }).where(and(eq(schema.partyBoatMembers.boatId, captain.boatId), eq(schema.partyBoatMembers.playerId, target.id)));
    return { success: true };
  });

  app.post('/api/party-boats/members/:publicId/captain', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const captain = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)))[0];
    if (!captain || captain.role !== 'captain') throw new AppError('NOT_CAPTAIN', '只有船长可以转让。');
    const target = (await db.select().from(schema.players).where(eq(schema.players.publicId, Number((req.params as any).publicId))))[0];
    if (!target) throw new AppError('PLAYER_NOT_FOUND', '玩家不存在。');
    await db.transaction(async (tx) => {
      await tx.update(schema.partyBoatMembers).set({ role: 'crew' }).where(and(eq(schema.partyBoatMembers.boatId, captain.boatId), eq(schema.partyBoatMembers.playerId, player.id)));
      await tx.update(schema.partyBoatMembers).set({ role: 'captain' }).where(and(eq(schema.partyBoatMembers.boatId, captain.boatId), eq(schema.partyBoatMembers.playerId, target.id)));
      await tx.update(schema.partyBoats).set({ captainId: target.id }).where(eq(schema.partyBoats.id, captain.boatId));
    });
    return { success: true };
  });

  app.post('/api/party-boats/members/:publicId/remove', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const captain = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)))[0];
    if (!captain || captain.role !== 'captain') throw new AppError('NOT_CAPTAIN', '只有船长可以移除成员。');
    const target = (await db.select().from(schema.players).where(eq(schema.players.publicId, Number((req.params as any).publicId))))[0];
    if (!target) throw new AppError('PLAYER_NOT_FOUND', '玩家不存在。');
    await db.delete(schema.partyBoatMembers).where(and(eq(schema.partyBoatMembers.boatId, captain.boatId), eq(schema.partyBoatMembers.playerId, target.id)));
    return { success: true };
  });

  app.delete('/api/party-boats/members/:publicId', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const captain = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)))[0];
    if (!captain || captain.role !== 'captain') throw new AppError('NOT_CAPTAIN', '只有船长可以移除成员。');
    const target = (await db.select().from(schema.players).where(eq(schema.players.publicId, Number((req.params as any).publicId))))[0];
    if (!target) throw new AppError('PLAYER_NOT_FOUND', '玩家不存在。');
    await db.delete(schema.partyBoatMembers).where(and(eq(schema.partyBoatMembers.boatId, captain.boatId), eq(schema.partyBoatMembers.playerId, target.id)));
    return { success: true };
  });

  app.get('/api/party-boats/treasury', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const member = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)))[0];
    const boat = member ? (await db.select().from(schema.partyBoats).where(eq(schema.partyBoats.id, member.boatId)))[0] : null;
    if (!boat) throw new AppError('NOT_IN_PARTY', '你不在船队中。');
    const [members, players] = await Promise.all([
      db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.boatId, boat.id)),
      db.select().from(schema.players),
    ]);
    const playerMap = new Map(players.map((item) => [item.id, item]));
    const contributors = members.map((item) => {
      const row = playerMap.get(item.playerId);
      return {
        identity: {
          publicId: row?.publicId ?? 0, nickname: row?.nickname ?? '未知玩家', guildTag: null, level: row?.level ?? 0,
          avatar: { id: row?.avatarId ?? 'moonfall-scout', name: row?.avatarId ?? 'moonfall-scout', imagePath: `/api/avatars/${row?.avatarId ?? 'moonfall-scout'}/image`, isActive: true },
          equippedTitle: null, nameStyle: { mode: row?.nameStyleMode ?? 'default', colors: row?.nameStyleColors ?? [], angle: row?.nameStyleAngle ?? undefined },
        },
        donatedGold: 0, donationCount: 0, lastDonatedAt: null,
      };
    });
    return { targetId: boat.id, boatName: boat.name, treasuryGold: boat.treasuryGold, totalDonatedGold: 0, contributors, items: [], entries: [], nextCursor: null, serverTime: new Date().toISOString() };
  });

  app.post('/api/party-boats/join-by-code', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const code = String((req.body as any)?.code ?? '').toUpperCase();
    const boat = (await db.select().from(schema.partyBoats).where(and(eq(schema.partyBoats.joinCode, code), eq(schema.partyBoats.status, 'active'))))[0];
    if (!boat) throw new AppError('BOAT_NOT_FOUND', '邀请码无效。');
    const members = await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.boatId, boat.id));
    const def = (await db.select().from(schema.boatDefinitions).where(eq(schema.boatDefinitions.id, boat.boatDefinitionId)))[0];
    if (members.length >= (def?.capacity ?? 3)) throw new AppError('BOAT_FULL', '船队已满员。');
    const existing = await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id));
    if (existing.length) throw new AppError('ALREADY_IN_PARTY', '你已在船队中。');
    await db.insert(schema.partyBoatMembers).values({ boatId: boat.id, playerId: player.id, role: 'crew' });
    return { success: true, boat: { id: boat.id, name: boat.name } };
  });

  app.post('/api/party-boats/leave', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const member = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)))[0];
    if (!member) throw new AppError('NOT_IN_PARTY', '你不在船队中。');
    if (member.role === 'captain') throw new AppError('CAPTAIN_LEAVE', '船长需先解散或转让。');
    await db.delete(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id));
    return { success: true };
  });

  app.post('/api/party-boats/disband', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const member = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)))[0];
    if (!member || member.role !== 'captain') throw new AppError('NOT_CAPTAIN', '只有船长可以解散。');
    await db.delete(schema.partyBoats).where(eq(schema.partyBoats.id, member.boatId));
    return { success: true };
  });

  app.post('/api/party-boats/upkeep', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const member = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)))[0];
    if (!member || member.role !== 'captain') throw new AppError('NOT_CAPTAIN', '只有船长可以支付保养。');
    const boat = (await db.select().from(schema.partyBoats).where(eq(schema.partyBoats.id, member.boatId)))[0];
    const def = (await db.select().from(schema.boatDefinitions).where(eq(schema.boatDefinitions.id, boat.boatDefinitionId)))[0];
    if (player.gold < def.maintenanceFourteenDayGold) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${def.maintenanceFourteenDayGold}` }).where(eq(schema.players.id, player.id));
      await tx.update(schema.partyBoats).set({ maintenanceDueAt: new Date(Date.now() + 14 * 24 * 3600 * 1000), upkeepPaidAt: new Date() }).where(eq(schema.partyBoats.id, boat.id));
    });
    return { success: true };
  });

  app.post('/api/party-boats/rental/extend', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = req.body as any;
    const billingUnit = body?.billingUnit === 'day' ? 'day' : 'hour';
    const quantity = Math.max(1, Number(body?.quantity ?? body?.hours ?? 24));
    const hours = billingUnit === 'day' ? quantity * 24 : quantity;
    const member = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)))[0];
    if (!member || member.role !== 'captain') throw new AppError('NOT_CAPTAIN', '只有船长可以续租。');
    const boat = (await db.select().from(schema.partyBoats).where(eq(schema.partyBoats.id, member.boatId)))[0];
    const def = (await db.select().from(schema.boatDefinitions).where(eq(schema.boatDefinitions.id, boat.boatDefinitionId)))[0];
    const cost = billingUnit === 'day' ? def.dailyRentGold * quantity : def.hourlyRentGold * quantity;
    if (body?.maxGoldCost !== undefined && cost > Number(body.maxGoldCost)) throw new AppError('PRICE_CHANGED', '续租价格已经变化，请重新确认。');
    if (boat.treasuryGold < cost) throw new AppError('INSUFFICIENT_TREASURY', '船队金库余额不足。');
    await db.transaction(async (tx) => {
      await tx.update(schema.partyBoats).set({ treasuryGold: sql`${schema.partyBoats.treasuryGold} - ${cost}` }).where(eq(schema.partyBoats.id, boat.id));
      await tx.update(schema.partyBoats).set({
        rentalEndsAt: new Date(Math.max(Date.now(), boat.rentalEndsAt?.getTime() ?? Date.now()) + hours * 3600 * 1000),
      }).where(eq(schema.partyBoats.id, boat.id));
    });
    return { success: true };
  });

  app.post('/api/party-boats/treasury/deposit', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const gold = Math.max(1, Number((req.body as any)?.amount ?? (req.body as any)?.gold ?? 0));
    const member = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)))[0];
    if (!member) throw new AppError('NOT_IN_PARTY', '你不在船队中。');
    if (player.gold < gold) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${gold}` }).where(eq(schema.players.id, player.id));
      await tx.update(schema.partyBoats).set({ treasuryGold: sql`${schema.partyBoats.treasuryGold} + ${gold}` }).where(eq(schema.partyBoats.id, member.boatId));
    });
    return { success: true };
  });

  app.get('/api/party-boats/members', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const member = (await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.playerId, player.id)))[0];
    if (!member) return { members: [] };
    const rows = await db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.boatId, member.boatId));
    const players = await db.select().from(schema.players);
    const pMap = new Map(players.map((p) => [p.id, p]));
    return { members: rows.map((m) => ({ playerId: m.playerId, publicId: pMap.get(m.playerId)?.publicId ?? 0, nickname: pMap.get(m.playerId)?.nickname ?? '未知', level: pMap.get(m.playerId)?.level ?? 0, role: m.role, joinedAt: m.joinedAt.toISOString() })) };
  });
}

async function currentCrowdfunding(boatId: string) {
  const [boat, defs, members] = await Promise.all([
    db.select().from(schema.partyBoats).where(eq(schema.partyBoats.id, boatId)),
    db.select().from(schema.boatDefinitions),
    db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.boatId, boatId)),
  ]);
  const row = boat[0];
  if (!row) return null;
  const def = defs.find((item) => item.id === row.boatDefinitionId);
  return {
    id: row.id,
    kind: 'new',
    status: row.status,
    boatDefinitionId: row.boatDefinitionId,
    visibility: row.visibility,
    participantCount: members.length,
    requiredParticipantCount: def?.capacity ?? 3,
    participantGold: Math.ceil(Number(row.crowdfundingTarget) / Math.max(2, def?.capacity ?? 3)),
    collectedGold: row.crowdfundingGold,
    targetGold: row.crowdfundingTarget,
    treasuryGoldReserved: 0,
    joinCode: row.joinCode,
    canCancel: true,
  };
}

async function buildCrewSnapshot(boat: typeof schema.partyBoats.$inferSelect, defs: (typeof schema.boatDefinitions.$inferSelect)[], currentPlayerId: string) {
  const [memberRows, allPlayers, titleRows] = await Promise.all([
    db.select().from(schema.partyBoatMembers).where(eq(schema.partyBoatMembers.boatId, boat.id)),
    db.select().from(schema.players),
    db.select().from(schema.titles),
  ]);
  const playerMap = new Map(allPlayers.map((player) => [player.id, player]));
  const titleMap = new Map(titleRows.map((title) => [title.id, title]));
  const def = defs.find((item) => item.id === boat.boatDefinitionId);
  const status = boat.isPermanent
    ? (boat.maintenanceDueAt && boat.maintenanceDueAt < new Date() ? 'maintenance_due' : 'active')
    : (boat.rentalEndsAt && boat.rentalEndsAt < new Date() ? 'rental_due' : 'active');
  const members = memberRows.map((member) => {
    const player = playerMap.get(member.playerId);
    if (!player) return null;
    const title = player.equippedTitleId ? titleMap.get(player.equippedTitleId) : null;
    return {
      identity: {
        publicId: player.publicId,
        nickname: player.nickname,
        guildTag: null,
        level: player.level,
        avatar: { id: player.avatarId, name: player.avatarId, imagePath: `/api/avatars/${player.avatarId}/image`, isActive: true },
        equippedTitle: title ? { id: title.id, name: title.name, imagePath: title.imagePath, description: title.description } : null,
        nameStyle: { mode: player.nameStyleMode, colors: player.nameStyleColors ?? [], angle: player.nameStyleAngle ?? undefined },
      },
      role: member.role === 'helm' ? 'helmsman' : member.role,
      currentBiomeId: player.currentBiomeId,
      joinedAt: member.joinedAt.toISOString(),
      isEffectiveForCurrentPlayer: player.currentBiomeId === boat.biomeId,
      fishingStatus: player.currentBiomeId === boat.biomeId ? 'online_fishing' : 'not_fishing',
    };
  }).filter(Boolean).sort((a: any, b: any) => (a.role === 'captain' ? -1 : b.role === 'captain' ? 1 : a.identity.publicId - b.identity.publicId));
  return {
    id: boat.id,
    boatId: boat.id,
    name: boat.name,
    boatDefinitionId: boat.boatDefinitionId,
    capacity: def?.capacity ?? 3,
    status,
    source: boat.isPermanent ? 'owned' : 'rented',
    visibility: boat.visibility,
    joinCode: boat.joinCode,
    currentBiomeId: boat.biomeId,
    partyBonusBasisPoints: Math.max(0, members.length - 1) * 500,
    treasuryGold: boat.treasuryGold,
    rentalEndsAt: boat.rentalEndsAt?.toISOString() ?? null,
    maintenanceDueAt: boat.maintenanceDueAt?.toISOString() ?? null,
    isCrowdfunded: boat.crowdfundingTarget > 0,
    purchasedPriceSnapshot: def?.permanentPriceGold ?? null,
    members,
  };
}

function levelUpCostFor(level: number): number {
  return Math.floor(100000 * Math.pow(2, level - 1));
}

function totemPublic(t: typeof schema.guildTotems.$inferSelect) {
  const typeNames: Record<string, string> = { experience: '经验图腾', gold: '金币图腾', luck: '幸运图腾', relic: '遗物图腾' };
  return {
    id: t.id,
    type: t.type,
    name: typeNames[t.type] ?? t.type,
    level: t.level,
    upgradeCost: levelUpCostFor(t.level),
    donatedGold: t.donatedGold,
    activatedUntil: t.activatedUntil?.toISOString() ?? null,
    activationCostGold: t.activationCostGold,
    boostCostGold: t.boostCostGold,
    boostDurationMinutes: t.boostDurationMinutes,
    boostMaxUnits: t.boostMaxUnits,
    boostedUnits: t.boostedUnits,
    boostStartsAt: t.boostStartsAt?.toISOString() ?? null,
    boostEndsAt: t.boostEndsAt?.toISOString() ?? null,
    isActive: !!t.activatedUntil && t.activatedUntil > new Date(),
  };
}

function guildNumericId(id: string) {
  return 10000 + (parseInt(id.replace(/-/g, '').slice(0, 8), 16) % 80000);
}

function guildIdentity(player: typeof schema.players.$inferSelect) {
  return {
    publicId: player.publicId,
    nickname: player.nickname,
    guildTag: null,
    level: player.level,
    avatar: { id: player.avatarId, name: player.avatarId, imagePath: `/api/avatars/${player.avatarId}/image`, isActive: true },
    equippedTitle: null,
    nameStyle: { mode: player.nameStyleMode, colors: player.nameStyleColors ?? [], angle: player.nameStyleAngle ?? undefined },
  };
}

function guildPublic(g: typeof schema.guilds.$inferSelect) {
  return {
    id: g.id,
    publicId: guildNumericId(g.id),
    name: g.name,
    tag: g.tag,
    publicDescription: g.publicDescription,
    announcement: g.announcement,
    level: g.level,
    experience: g.experience,
    taxRatePercent: g.taxRatePercent,
    treasuryGold: g.treasuryGold,
    leaderId: g.leaderId,
    nameStyle: { mode: g.nameStyleMode, colors: g.nameStyleColors ?? [] },
    createdAt: g.createdAt.toISOString(),
  };
}

function genCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
