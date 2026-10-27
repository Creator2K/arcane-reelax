import { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { requireAuth } from '../services/auth.js';
import { AppError } from '../util/errors.js';
import { loadPlayerContext } from '../services/playerState.js';

const ATTACK_COST_GOLD = 5000;
const ATTACK_COOLDOWN_MS = 30_000;

export async function registerWorldBossRoutes(app: FastifyInstance) {
  app.get('/api/events/world-boss', async (req, reply) => {
    await requireAuth(req, reply);
    return {
      session: null,
      nextPrepareAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
      serverTime: new Date().toISOString(),
    };
  });

  app.get('/api/events/world-boss/history', async (req, reply) => {
    await requireAuth(req, reply);
    return { items: [], nextCursor: null, serverTime: new Date().toISOString() };
  });

  app.get('/api/events/world-boss/collections', async (req, reply) => {
    await requireAuth(req, reply);
    const bosses = await db.select().from(schema.worldBosses).orderBy(asc(schema.worldBosses.startsAt));
    const imageNames = ['junhai', 'miguang', 'sereia', 'wumo'];
    const sets = bosses.length ? bosses.map((boss, index) => ({
      boss: {
        id: boss.id,
        name: boss.name,
        epithet: index === 0 ? '潮渊巨影' : '深渊遗嗣',
        imagePath: `/world-boss/bosses/${imageNames[index % imageNames.length]}.webp`,
      },
      registeredCount: 0,
      items: [],
      isTitleUnlocked: false,
      title: {
        id: `world_boss_collector_${boss.id}`,
        name: `${boss.name}收藏家`,
        description: `登记${boss.name}的全部 8 件遗珍。`,
        style: { textColor: '#355A78', borderColor: '#78ACCF', borderEffect: 'wave', backgroundColor: '#EDF6FC' },
      },
    })) : [{
      boss: { id: 'tide_devourer', name: '潮渊吞舟兽', epithet: '潮渊巨影', imagePath: '/world-boss/bosses/junhai.webp' },
      registeredCount: 0,
      items: [],
      isTitleUnlocked: false,
      title: { id: 'world_boss_collector', name: '渊潮收藏家', description: '登记全部世界首领收藏品。', style: {} },
    }];
    return { sets, serverTime: new Date().toISOString() };
  });

  app.post('/api/events/world-boss/collections/register', async (req, reply) => {
    await requireAuth(req, reply);
    const itemId = String((req.body as any)?.itemId ?? '');
    throw new AppError('COLLECTIBLE_NOT_OWNED', `尚未持有收藏品 ${itemId}，无法登记。`, 409);
  });

  app.post('/api/events/world-boss/selection', async (req, reply) => {
    await requireAuth(req, reply);
    const stat = String((req.body as any)?.stat ?? 'strength');
    return { overview: { session: null, nextPrepareAt: new Date(Date.now() + 3 * 3600_000).toISOString(), serverTime: new Date().toISOString(), selectedStat: stat } };
  });

  app.post('/api/events/world-boss/attack', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const boss = (await db.select().from(schema.worldBosses).where(eq(schema.worldBosses.status, 'active')).limit(1))[0];
    if (!boss) throw new AppError('WORLD_BOSS_NOT_ACTIVE', '当前没有进行中的世界首领。');
    if (boss.endsAt < new Date()) throw new AppError('WORLD_BOSS_ENDED', '世界首领已经离开。');
    if (boss.currentHp <= 0) throw new AppError('WORLD_BOSS_DEFEATED', '世界首领已被击退。');
    if (player.gold < ATTACK_COST_GOLD) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    const existing = (await db.select().from(schema.worldBossDamage).where(and(eq(schema.worldBossDamage.bossId, boss.id), eq(schema.worldBossDamage.playerId, player.id))))[0];
    const remaining = existing ? ATTACK_COOLDOWN_MS - (Date.now() - existing.updatedAt.getTime()) : 0;
    if (remaining > 0) throw new AppError('WORLD_BOSS_COOLDOWN', `钓组仍在整备，请 ${Math.ceil(remaining / 1000)} 秒后再试。`);

    const context = await loadPlayerContext(player.id);
    const stats = context.stats.total;
    const base = player.level * 45 + (stats.strength + stats.intelligence + stats.luck + stats.endurance) * 2.5;
    const damage = Math.max(100, Math.round(base * (0.8 + Math.random() * 0.45)));
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${ATTACK_COST_GOLD}` }).where(eq(schema.players.id, player.id));
      if (existing) {
        await tx.update(schema.worldBossDamage).set({
          damage: sql`${schema.worldBossDamage.damage} + ${damage}`,
          attacks: sql`${schema.worldBossDamage.attacks} + 1`,
          updatedAt: new Date(),
        }).where(and(eq(schema.worldBossDamage.bossId, boss.id), eq(schema.worldBossDamage.playerId, player.id)));
      } else {
        await tx.insert(schema.worldBossDamage).values({ bossId: boss.id, playerId: player.id, damage, attacks: 1 });
      }
      const newHp = Math.max(0, boss.currentHp - damage);
      await tx.update(schema.worldBosses).set({
        currentHp: newHp,
        status: newHp <= 0 ? 'completed' : 'active',
      }).where(eq(schema.worldBosses.id, boss.id));
    });
    return { success: true, damage, costGold: ATTACK_COST_GOLD, remainingHp: Math.max(0, boss.currentHp - damage), defeated: boss.currentHp - damage <= 0 };
  });
}
