import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { eq, and, sql, desc } from 'drizzle-orm';
import { requireAuth } from '../services/auth.js';
import { AppError } from '../util/errors.js';
import { chinaDate } from './auth.js';
import { EXCHANGE_LIMITS } from '../constants.js';

export async function registerShopRoutes(app: FastifyInstance) {
  app.get('/api/shop', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const q = req.query as any;
    const tab = String(q.tab ?? 'relic');
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(100, Number(q.limit ?? 8));
    const queuePage = Math.max(1, Number(q.queuePage ?? 1));
    const queueLimit = Math.min(100, Number(q.queueLimit ?? 8));

    const [shop, buffs, avatars] = await Promise.all([
      db.select().from(schema.shopBuffs).orderBy(schema.shopBuffs.orderIndex),
      db.select().from(schema.shopBuffs).where(eq(schema.shopBuffs.shop, tab)),
      db.select().from(schema.avatars).where(eq(schema.avatars.source, 'shop')),
    ]);

    const buffProducts = buffs.filter((b) => b.shop === tab);
    const avatarProducts = avatars.map((a) => {
      const price = a.priceRelics ?? a.priceFragments ?? 0;
      const currency = a.priceRelics ? 'relic' : a.priceFragments ? 'fragment' : 'relic';
      return {
        id: a.id,
        name: a.name,
        description: '永久解锁的原创个人资料头像',
        shop: tab,
        currency,
        productType: 'avatar',
        price,
        isActive: true,
        isOwned: false,
        avatar: { id: a.id, name: a.name, imagePath: a.imagePath, isActive: true },
      };
    });

    const totalItems = buffProducts.length + (tab === 'relic' ? avatarProducts.length : 0);
    const paged = buffProducts.slice((page - 1) * limit, page * limit);

    const balances = {
      gold: player.gold,
      relics: player.relics,
      fragments: player.fragments,
    };

    const personalBuffs = await db.select().from(schema.playerBuffs).where(and(
      eq(schema.playerBuffs.playerId, player.id), sql`${schema.playerBuffs.endsAt} > now()`,
    ));
    const globalBuffs = await db.select().from(schema.globalBuffs).where(sql`${schema.globalBuffs.endsAt} > now()`);

    const exchangeQuotes = {
      goldToRelic: await exchangeQuote('goldToRelic'),
      goldToFragment: await exchangeQuote('goldToFragment'),
    };

    const pageCount = Math.max(1, Math.ceil(totalItems / limit));
    const queue = await db.select().from(schema.globalBuffs).where(sql`${schema.globalBuffs.endsAt} > now()`).orderBy(schema.globalBuffs.startsAt);

    return {
      tab,
      buffProducts: paged,
      avatarProducts: tab === 'avatar' ? avatarProducts.slice((page - 1) * limit, page * limit) : [],
      page,
      totalPages: pageCount,
      totalItems,
      balances,
      personalBuffs: personalBuffs.map(buffPublic),
      globalBuffs: globalBuffs.map(buffPublic),
      exchangeQuotes,
      nextStateChangeAt: null,
      queue: queue.slice((queuePage - 1) * queueLimit, queuePage * queueLimit),
      queuePage,
      queueTotalPages: Math.max(1, Math.ceil(queue.length / queueLimit)),
      serverTime: new Date().toISOString(),
    };
  });

  app.get('/api/shop/v2', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const q = req.query as any;
    const tab = String(q.tab ?? 'relic');
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(100, Number(q.limit ?? 24));
    const [buffs, avatars, personalBuffs, weeklyState] = await Promise.all([
      db.select().from(schema.shopBuffs).where(eq(schema.shopBuffs.shop, tab)).orderBy(schema.shopBuffs.orderIndex),
      tab === 'relic' ? db.select().from(schema.avatars).where(eq(schema.avatars.source, 'shop')).orderBy(schema.avatars.orderIndex) : Promise.resolve([]),
      db.select().from(schema.playerBuffs).where(and(eq(schema.playerBuffs.playerId, player.id), sql`${schema.playerBuffs.endsAt} > now()`)),
      tab === 'exchange' ? weeklyExchangeState(player.id) : Promise.resolve(null),
    ]);
    const buffProducts = buffs.map((item: any) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      shop: item.shop,
      currency: item.currency,
      productType: item.productType,
      price: item.price,
      isActive: item.isActive,
      isOwned: false,
      buff: {
        category: item.buffCategory,
        bonusBasisPoints: item.bonusBasisPoints,
        durationSeconds: item.durationSeconds,
      },
    }));
    const avatarProducts = avatars.map((item: any) => {
      const currency = item.priceRelics ? 'relic' : 'fragment';
      const price = item.priceRelics ?? item.priceFragments ?? 0;
      return {
        id: item.id,
        name: item.name,
        description: '永久解锁的原创个人资料头像',
        shop: tab,
        currency,
        productType: 'avatar',
        price,
        isActive: item.isActive,
        isOwned: false,
        avatar: { id: item.id, name: item.name, imagePath: item.imagePath, isActive: item.isActive },
      };
    });
    const totalItems = avatarProducts.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const start = (page - 1) * limit;
    return {
      tab,
      buffProducts,
      avatarProducts: avatarProducts.slice(start, start + limit),
      page,
      totalPages,
      totalItems,
      balances: { gold: player.gold, relics: player.relics, fragments: player.fragments },
      personalBuffs: personalBuffs.map(buffPublic),
      globalBuffs: null,
      exchangeQuotes: weeklyState?.exchangeQuotes ?? [],
      fragmentExchange: weeklyState?.fragmentExchange ?? null,
      nextStateChangeAt: weeklyState?.nextStateChangeAt ?? null,
      serverTime: new Date().toISOString(),
    };
  });

  app.post('/api/shop/purchases', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({
      productId: z.string(),
      productType: z.enum(['personal_buff', 'global_buff', 'avatar']).optional(),
      quantity: z.number().int().min(1).max(999).optional().default(1),
    }).parse(req.body as any);

    const avatar = (await db.select().from(schema.avatars).where(eq(schema.avatars.id, body.productId)))[0];
    if (avatar || body.productType === 'avatar') {
      if (!avatar) throw new AppError('PRODUCT_NOT_FOUND', '商品不存在。');
      const price = avatar.priceRelics ?? avatar.priceFragments ?? 0;
      const currency = avatar.priceRelics ? 'relics' : 'fragments';
      if (player[currency as 'relics'] < price) throw new AppError('INSUFFICIENT_FUNDS', '余额不足。');
      const owned = await db.select().from(schema.playerAvatars).where(and(
        eq(schema.playerAvatars.playerId, player.id), eq(schema.playerAvatars.avatarId, avatar.id),
      ));
      if (owned.length) throw new AppError('ALREADY_OWNED', '已拥有该头像。');
      await db.transaction(async (tx) => {
        await tx.update(schema.players).set({ [currency]: sql`${currency === 'relics' ? schema.players.relics : schema.players.fragments} - ${price}` }).where(eq(schema.players.id, player.id));
        await tx.insert(schema.playerAvatars).values({ playerId: player.id, avatarId: avatar.id });
      });
      const product = {
        id: avatar.id, name: avatar.name, description: '永久解锁的原创个人资料头像', shop: 'relic',
        currency: avatar.priceRelics ? 'relic' : 'fragment', productType: 'avatar', price, isActive: true, isOwned: true,
        avatar: { id: avatar.id, name: avatar.name, imagePath: avatar.imagePath, isActive: true },
      };
      return { success: true, product, quantity: 1, ownedAvatarId: avatar.id, balances: await balancesOf(player.id), serverTime: new Date().toISOString() };
    }

    const buff = (await db.select().from(schema.shopBuffs).where(eq(schema.shopBuffs.id, body.productId)))[0];
    if (!buff) throw new AppError('PRODUCT_NOT_FOUND', '商品不存在。');
    const totalPrice = buff.price * body.quantity;
    const currency = buff.currency === 'relic' ? 'relics' : 'fragments';
    if (player[currency as 'relics'] < totalPrice) throw new AppError('INSUFFICIENT_FUNDS', '余额不足。');

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ [currency]: sql`${currency === 'relics' ? schema.players.relics : schema.players.fragments} - ${totalPrice}` }).where(eq(schema.players.id, player.id));
      for (let i = 0; i < body.quantity; i++) {
        if (buff.isGlobal) {
          await tx.insert(schema.globalBuffs).values({
            buffType: buff.buffCategory, bonusBasisPoints: buff.bonusBasisPoints, purchaserId: player.id,
            startsAt: now, endsAt: new Date(now.getTime() + buff.durationSeconds * 1000),
          });
        } else {
          await tx.insert(schema.playerBuffs).values({
            playerId: player.id, source: 'player_shop', buffType: buff.buffCategory,
            bonusBasisPoints: buff.bonusBasisPoints, startsAt: now, endsAt: new Date(now.getTime() + buff.durationSeconds * 1000),
          });
        }
      }
    });
    const product = {
      id: buff.id, name: buff.name, description: buff.description, shop: buff.shop, currency: buff.currency,
      productType: buff.productType, price: buff.price, isActive: true, isOwned: false,
      buff: { category: buff.buffCategory, bonusBasisPoints: buff.bonusBasisPoints, durationSeconds: buff.durationSeconds },
    };
    const newestBuff = (await db.select().from(schema.playerBuffs).where(eq(schema.playerBuffs.playerId, player.id)).orderBy(desc(schema.playerBuffs.startsAt)).limit(1))[0];
    return {
      success: true, product, quantity: body.quantity, balances: await balancesOf(player.id), serverTime: new Date().toISOString(),
      personalBuff: !buff.isGlobal && newestBuff ? {
        id: newestBuff.id, shop: buff.shop, category: buff.buffCategory, productId: buff.id,
        bonusBasisPoints: buff.bonusBasisPoints, startsAt: newestBuff.startsAt.toISOString(), endsAt: newestBuff.endsAt.toISOString(),
        status: newestBuff.endsAt > now ? 'active' : 'queued',
      } : undefined,
    };
  });

  app.get('/api/shop/exchange-quote', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const kind = String((req.query as any).kind ?? 'goldToRelic');
    return { ...await exchangeQuote(kind as 'goldToRelic'), balances: await balancesOf(player.id), serverTime: new Date().toISOString() };
  });

  app.post('/api/shop/exchanges', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({
      kind: z.enum(['goldToRelic', 'goldToFragment']),
      quantity: z.number().int().min(1).max(100000),
    }).parse(req.body as any);

    const today = chinaDate();
    const quote = await exchangeQuote(body.kind);
    const isRelic = body.kind === 'goldToRelic';
    const max = isRelic ? EXCHANGE_LIMITS.goldToRelicDailyMax : EXCHANGE_LIMITS.goldToFragmentDailyMax;

    const used = await db.select({
      total: sql<number>`COALESCE(sum(amount), 0)::int`,
    }).from(schema.exchangeLogs).where(and(
      eq(schema.exchangeLogs.playerId, player.id),
      eq(schema.exchangeLogs.kind, body.kind),
      eq(schema.exchangeLogs.date, today),
    ));
    const usedCount = Number(used[0]?.total ?? 0);
    const remaining = Math.max(0, max - usedCount);
    if (body.quantity > remaining) throw new AppError('DAILY_LIMIT', '今日兑换数量已达上限。');

    const cost = quote.currentUnitPrice * body.quantity;
    if (player.gold < cost) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');

    const gained = isRelic ? body.quantity : body.quantity;
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({
        gold: sql`${schema.players.gold} - ${cost}`,
        relics: isRelic ? sql`${schema.players.relics} + ${gained}` : schema.players.relics,
        fragments: !isRelic ? sql`${schema.players.fragments} + ${gained}` : schema.players.fragments,
      }).where(eq(schema.players.id, player.id));
      await tx.insert(schema.exchangeLogs).values({ playerId: player.id, kind: body.kind, amount: body.quantity, goldCost: cost, date: today });
    });

    return {
      success: true,
      balances: await balancesOf(player.id),
      quote: await exchangeQuote(body.kind),
      serverTime: new Date().toISOString(),
    };
  });

  app.get('/api/shop/weekly-exchange-quote', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const query = req.query as any;
    const target = z.enum(['relic', 'fragment']).parse(query.target);
    const quantity = z.number().int().min(1).max(1_000_000).parse(Number(query.quantity));
    return weeklyExchangeQuote(player.id, target, quantity);
  });

  app.post('/api/shop/weekly-exchanges', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({
      target: z.enum(['relic', 'fragment']),
      quantity: z.number().int().min(1).max(1_000_000),
      maxGoldCost: z.number().int().positive(),
    }).parse(req.body as any);
    const quote = await weeklyExchangeQuote(player.id, body.target, body.quantity);
    if (quote.goldCost > body.maxGoldCost) throw new AppError('PRICE_CHANGED', '兑换价格已经变化，请重新确认。');
    if (quote.quote.remainingQuantity < body.quantity) throw new AppError('WEEKLY_LIMIT', '本周兑换额度不足。');
    if (player.gold < quote.goldCost) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    const week = chinaWeekStart();
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({
        gold: sql`${schema.players.gold} - ${quote.goldCost}`,
        relics: body.target === 'relic' ? sql`${schema.players.relics} + ${body.quantity}` : schema.players.relics,
        fragments: body.target === 'fragment' ? sql`${schema.players.fragments} + ${body.quantity}` : schema.players.fragments,
      }).where(eq(schema.players.id, player.id));
      await tx.insert(schema.exchangeLogs).values({ playerId: player.id, kind: `weekly-${body.target}`, amount: body.quantity, goldCost: quote.goldCost, date: week.weekStart });
    });
    const state = await weeklyExchangeState(player.id);
    return {
      target: body.target, quantity: body.quantity, goldCost: quote.goldCost,
      balances: await balancesOf(player.id), ...state, serverTime: new Date().toISOString(),
    };
  });

  app.post('/api/shop/fragment-exchanges', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({ quantity: z.number().int().min(1).max(1_000_000), expectedRelicsPerFragment: z.number().int().min(1).max(1_000_000) }).parse(req.body as any);
    const ratio = 5;
    if (body.expectedRelicsPerFragment !== ratio) throw new AppError('RATIO_CHANGED', '兑换比例已经变化，请重新确认。');
    const state = await weeklyExchangeState(player.id);
    if (body.quantity > state.fragmentExchange.remainingQuantity) throw new AppError('WEEKLY_LIMIT', '本周碎片兑换额度不足。');
    if (player.fragments < body.quantity) throw new AppError('INSUFFICIENT_FRAGMENTS', '奥秘碎片不足。');
    const week = chinaWeekStart();
    const relicsReceived = body.quantity * ratio;
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ fragments: sql`${schema.players.fragments} - ${body.quantity}`, relics: sql`${schema.players.relics} + ${relicsReceived}` }).where(eq(schema.players.id, player.id));
      await tx.insert(schema.exchangeLogs).values({ playerId: player.id, kind: 'weekly-fragment-relic', amount: body.quantity, goldCost: 0, date: week.weekStart });
    });
    const next = await weeklyExchangeState(player.id);
    return { fragmentsSpent: body.quantity, relicsReceived, balances: await balancesOf(player.id), ...next, serverTime: new Date().toISOString() };
  });

  app.get('/api/convenience', async (req, reply) => {
    const player = await requireAuth(req, reply);
    return convenienceState(player.id);
  });

  app.put('/api/convenience/route-assistant/enabled', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const enabled = Boolean((req.body as any)?.enabled);
    const entitlements = await db.select().from(schema.convenienceEntitlements).where(eq(schema.convenienceEntitlements.playerId, player.id));
    const route = entitlements.find((item) => item.productId === 'route-assistant' && item.isActive && !!item.endsAt && item.endsAt > new Date());
    if (enabled && !route) throw new AppError('ROUTE_ASSISTANT_NOT_OWNED', '需要先购买航线助手。');
    await upsertSetting(`routeAssistant:${player.id}`, enabled);
    return convenienceState(player.id);
  });

  app.put('/api/convenience/route-assistant/settings', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const current = await loadRouteSettings(player.id);
    const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
    const next = {
      ...current,
      ...body,
      baitByScene: { ...current.baitByScene, ...(body.baitByScene as Record<string, unknown> | undefined) },
      arcaneSacrificeTargetByResource: { ...current.arcaneSacrificeTargetByResource, ...(body.arcaneSacrificeTargetByResource as Record<string, unknown> | undefined) },
    };
    await upsertSetting(`routeAssistantSettings:${player.id}`, next);
    return convenienceState(player.id);
  });

  app.post('/api/convenience/purchases', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({
      productId: z.enum(['unlimited-online-fishing', 'route-assistant']),
      durationDays: z.number().int().min(1).max(30),
    }).parse(req.body as any);
    const products = [
      { id: 'unlimited-online-fishing', days: [{ durationDays: 1, durationSeconds: 86400, price: 100 }, { durationDays: 30, durationSeconds: 2592000, price: 1000 }] },
      { id: 'route-assistant', days: [{ durationDays: 1, durationSeconds: 86400, price: 100 }, { durationDays: 30, durationSeconds: 2592000, price: 1000 }] },
    ];
    const product = products.find((p) => p.id === body.productId)!;
    const option = product.days.find((o: any) => o.durationDays === body.durationDays)!;
    if (player.gold < option.price) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${option.price}` }).where(eq(schema.players.id, player.id));
      await tx.insert(schema.convenienceEntitlements).values({
        playerId: player.id, productId: body.productId, isActive: true, endsAt: new Date(now.getTime() + option.durationSeconds * 1000),
      }).onConflictDoUpdate({
        target: [schema.convenienceEntitlements.playerId, schema.convenienceEntitlements.productId],
        set: { isActive: true, endsAt: sql`CASE WHEN ${schema.convenienceEntitlements.endsAt} > now() THEN ${schema.convenienceEntitlements.endsAt} + interval '${option.durationSeconds} seconds' ELSE now() + interval '${option.durationSeconds} seconds' END` },
      });
      await tx.insert(schema.conveniencePurchases).values({
        playerId: player.id, productId: body.productId, durationSeconds: option.durationSeconds, priceGold: option.price, startsAt: now, endsAt: new Date(now.getTime() + option.durationSeconds * 1000),
      });
    });
    return { ...(await convenienceState(player.id)), productId: body.productId, durationDays: body.durationDays, success: true };
  });

  app.post('/api/route-assistant/travel', async (req, reply) => {
    const player = await requireAuth(req, reply);
    return {
      status: 'idle',
      scope: 'personal',
      reason: 'no_route_change',
      targetBiomeId: player.currentBiomeId,
      currentBiomeId: player.currentBiomeId,
      personalTravel: null,
      partyTravel: null,
      serverTime: new Date().toISOString(),
    };
  });

  app.post('/api/route-assistant/world-boss/register', async (req, reply) => {
    await requireAuth(req, reply);
    return { overview: { session: null, nextPrepareAt: new Date(Date.now() + 3 * 3600_000).toISOString(), serverTime: new Date().toISOString() }, serverTime: new Date().toISOString() };
  });

  app.post('/api/route-assistant/arcane-sacrifice/contribute', async (req, reply) => {
    await requireAuth(req, reply);
    return { action: 'noop', contribution: null, serverTime: new Date().toISOString() };
  });

  app.post('/api/route-assistant/personal-experience-buff/purchase', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const shop = z.enum(['relic', 'fragment']).parse((req.body as any)?.shop);
    const buff = (await db.select().from(schema.shopBuffs).where(and(eq(schema.shopBuffs.shop, shop), eq(schema.shopBuffs.buffCategory, 'experience'))).orderBy(schema.shopBuffs.orderIndex).limit(1))[0];
    if (!buff) throw new AppError('PRODUCT_NOT_FOUND', '经验增益商品不存在。');
    const currency = buff.currency === 'relic' ? 'relics' : 'fragments';
    if (player[currency as 'relics'] < buff.price) throw new AppError('INSUFFICIENT_FUNDS', '余额不足。');
    const now = new Date();
    const endsAt = new Date(now.getTime() + buff.durationSeconds * 1000);
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set(currency === 'relics' ? { relics: sql`${schema.players.relics} - ${buff.price}` } : { fragments: sql`${schema.players.fragments} - ${buff.price}` }).where(eq(schema.players.id, player.id));
      await tx.insert(schema.playerBuffs).values({ playerId: player.id, source: 'player_shop', buffType: buff.buffCategory, bonusBasisPoints: buff.bonusBasisPoints, startsAt: now, endsAt });
    });
    return {
      balances: await balancesOf(player.id),
      personalBuff: { id: crypto.randomUUID(), shop, category: buff.buffCategory, productId: buff.id, productName: buff.name, bonusBasisPoints: buff.bonusBasisPoints, startsAt: now.toISOString(), endsAt: endsAt.toISOString(), status: 'active' },
      serverTime: new Date().toISOString(),
    };
  });

  app.post('/api/route-assistant/guild-experience-boost/activate', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const membership = (await db.select().from(schema.guildMembers).where(eq(schema.guildMembers.playerId, player.id)))[0];
    if (!membership) throw new AppError('NOT_IN_GUILD', '你不在公会中。');
    const guild = (await db.select().from(schema.guilds).where(eq(schema.guilds.id, membership.guildId)))[0];
    const now = new Date();
    const endsAt = new Date(now.getTime() + 3600_000);
    await db.insert(schema.guildBoosts).values({ guildId: guild.id, type: 'experience', isActive: true, startsAt: now, endsAt, purchasedUnits: 1 });
    return { action: 'activated', boost: { biomeId: player.currentBiomeId, startsAt: now.toISOString(), endsAt: endsAt.toISOString() }, serverTime: new Date().toISOString() };
  });

  app.get('/api/daily-check-in', async (req, reply) => {
    const player = await requireAuth(req, reply);
    return dailyCheckInState(player.id);
  });

  app.get('/api/daily-check-in/leaderboard', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const type = String((req.query as any)?.type ?? 'today');
    const today = chinaDate();
    const rows = await db.select().from(schema.dailyCheckIns).orderBy(desc(schema.dailyCheckIns.claimedAt)).limit(50);
    const players = await db.select().from(schema.players);
    const playerMap = new Map(players.map((item) => [item.id, item]));
    const entries = rows.map((row, index) => {
      const owner = playerMap.get(row.playerId);
      return {
        position: index + 1,
        identity: {
          publicId: owner?.publicId ?? 0, nickname: owner?.nickname ?? '未知玩家', guildTag: null, level: owner?.level ?? 0,
          avatar: { id: owner?.avatarId ?? 'moonfall-scout', name: owner?.avatarId ?? 'moonfall-scout', imagePath: `/api/avatars/${owner?.avatarId ?? 'moonfall-scout'}/image`, isActive: true },
          equippedTitle: null, nameStyle: { mode: owner?.nameStyleMode ?? 'default', colors: owner?.nameStyleColors ?? [], angle: owner?.nameStyleAngle ?? undefined },
        },
        streakDays: 0,
        checkedInAt: row.claimedAt.toISOString(),
        isCurrentPlayer: row.playerId === player.id,
      };
    });
    return { chinaDate: today, type, entries, currentPlayer: entries.find((entry) => entry.isCurrentPlayer) ?? null, serverTime: new Date().toISOString() };
  });

  app.post('/api/daily-check-in/claim', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const today = chinaDate();
    const rows = await db.select().from(schema.dailyCheckIns).where(eq(schema.dailyCheckIns.playerId, player.id)).orderBy(desc(schema.dailyCheckIns.claimedAt));
    const last = rows[0];
    if (last?.date === today) throw new AppError('ALREADY_CHECKED_IN', '今日已签到。');

    const rewards = [
      { gold: 100000, relics: 50, fragments: 0, chest: null },
      { gold: 100000, relics: 0, fragments: 10, chest: null },
      { gold: 0, relics: 0, fragments: 0, chest: { definitionId: 'magic_gear_chest', name: '魔法宝箱', quantity: 1 } },
      { gold: 0, relics: 200, fragments: 0, chest: null },
      { gold: 0, relics: 0, fragments: 0, chest: { definitionId: 'mysterious_gear_chest', name: '神话宝箱', quantity: 1 } },
      { gold: 0, relics: 0, fragments: 25, chest: null },
      { gold: 0, relics: 0, fragments: 0, chest: { definitionId: 'arcane_gear_chest', name: '奥术宝箱', quantity: 1 } },
    ];
    let cycleIndex = 1;
    if (last) {
      const lastDate = new Date(`${last.date}T00:00:00+08:00`);
      const todayDate = new Date(`${today}T00:00:00+08:00`);
      const diff = Math.round((todayDate.getTime() - lastDate.getTime()) / 86400000);
      cycleIndex = diff === 1 ? (last.cycleIndex % 7) + 1 : 1;
    }
    const reward = rewards[cycleIndex - 1];
    const claim = (await db.insert(schema.dailyCheckIns).values({
      playerId: player.id, date: today, cycleIndex, rewardDay: cycleIndex,
    }).returning())[0];

    const balances = await balancesOf(player.id);
    let chestBalance: any = null;
    if (reward.chest) {
      await db.insert(schema.playerChests).values({ playerId: player.id, chestId: reward.chest.definitionId, quantity: reward.chest.quantity })
        .onConflictDoUpdate({ target: [schema.playerChests.playerId, schema.playerChests.chestId], set: { quantity: sql`${schema.playerChests.quantity} + ${reward.chest.quantity}` } });
      chestBalance = (await db.select().from(schema.playerChests).where(and(eq(schema.playerChests.playerId, player.id), eq(schema.playerChests.chestId, reward.chest.definitionId))))[0];
    }
    await db.update(schema.players).set({
      gold: sql`${schema.players.gold} + ${reward.gold}`,
      relics: sql`${schema.players.relics} + ${reward.relics}`,
      fragments: sql`${schema.players.fragments} + ${reward.fragments}`,
    }).where(eq(schema.players.id, player.id));

    return {
      claim,
      balances: await balancesOf(player.id),
      chestBalance: chestBalance ? { chestId: chestBalance.chestId, quantity: chestBalance.quantity } : null,
      state: await dailyCheckInState(player.id),
      serverTime: new Date().toISOString(),
    };
  });
}

async function exchangeQuote(kind: 'goldToRelic' | 'goldToFragment') {
  const today = chinaDate();
  const isRelic = kind === 'goldToRelic';
  const dailyMax = isRelic ? EXCHANGE_LIMITS.goldToRelicDailyMax : EXCHANGE_LIMITS.goldToFragmentDailyMax;
  const basePrice = isRelic ? EXCHANGE_LIMITS.goldToRelicInitialPrice : EXCHANGE_LIMITS.goldToFragmentInitialPrice;
  const step = isRelic ? EXCHANGE_LIMITS.goldToRelicStep : EXCHANGE_LIMITS.goldToFragmentStep;
  const total = await db.select({ total: sql<number>`COALESCE(sum(amount), 0)::int` }).from(schema.exchangeLogs).where(eq(schema.exchangeLogs.date, today));
  const used = Number(total[0]?.total ?? 0);
  const currentUnitPrice = basePrice + used * step;
  return {
    kind,
    dailyLimit: dailyMax,
    usedToday: used,
    remainingToday: Math.max(0, dailyMax - used),
    currentUnitPrice,
    nextUnitPrice: currentUnitPrice + step,
    resetsAt: nextChinaMidnight().toISOString(),
  };
}

const WEEKLY_EXCHANGE_CONFIG = {
  relic: { weeklyLimit: 3000, baseUnitPrice: 3000, growthBasisPoints: 15000 },
  fragment: { weeklyLimit: 300, baseUnitPrice: 30000, growthBasisPoints: 10000 },
};
const FRAGMENT_WEEKLY_LIMIT = 1000;
const RELICS_PER_FRAGMENT = 5;

function chinaWeekStart(date = new Date()) {
  const china = new Date(date.getTime() + 8 * 3600_000);
  const day = (china.getUTCDay() + 6) % 7;
  const mondayUtc = Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate() - day) - 8 * 3600_000;
  const start = new Date(Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate() - day));
  return {
    weekStart: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-${String(start.getUTCDate()).padStart(2, '0')}`,
    resetsAt: new Date(mondayUtc + 7 * 86400_000).toISOString(),
  };
}

function weeklyUnitPrice(target: 'relic' | 'fragment', sold: number) {
  const config = WEEKLY_EXCHANGE_CONFIG[target];
  return Math.floor(config.baseUnitPrice * Math.pow(1 + config.growthBasisPoints / 10_000, sold));
}

function weeklyExchangeCost(target: 'relic' | 'fragment', sold: number, quantity: number) {
  let cost = 0;
  for (let index = 0; index < quantity; index += 1) cost += weeklyUnitPrice(target, sold + index);
  return cost;
}

async function weeklyExchangeState(playerId: string) {
  const week = chinaWeekStart();
  const logs = await db.select().from(schema.exchangeLogs).where(and(eq(schema.exchangeLogs.playerId, playerId), eq(schema.exchangeLogs.date, week.weekStart)));
  const soldFor = (kind: string) => logs.filter((row) => row.kind === kind).reduce((sum, row) => sum + Number(row.amount), 0);
  const exchangeQuotes = (['relic', 'fragment'] as const).map((target) => {
    const config = WEEKLY_EXCHANGE_CONFIG[target];
    const soldQuantity = soldFor(`weekly-${target}`);
    const remainingQuantity = Math.max(0, config.weeklyLimit - soldQuantity);
    return {
      target,
      weekStart: week.weekStart,
      resetsAt: week.resetsAt,
      weeklyLimit: config.weeklyLimit,
      baseUnitPrice: config.baseUnitPrice,
      growthBasisPoints: config.growthBasisPoints,
      soldQuantity,
      remainingQuantity,
      nextUnitPrice: remainingQuantity > 0 ? weeklyUnitPrice(target, soldQuantity) : null,
    };
  });
  const spentQuantity = soldFor('weekly-fragment-relic');
  return {
    exchangeQuotes,
    fragmentExchange: {
      relicsPerFragment: RELICS_PER_FRAGMENT,
      weeklyLimit: FRAGMENT_WEEKLY_LIMIT,
      spentQuantity,
      remainingQuantity: Math.max(0, FRAGMENT_WEEKLY_LIMIT - spentQuantity),
      weekStart: week.weekStart,
      resetsAt: week.resetsAt,
    },
    nextStateChangeAt: week.resetsAt,
  };
}

async function weeklyExchangeQuote(playerId: string, target: 'relic' | 'fragment', quantity: number) {
  const state = await weeklyExchangeState(playerId);
  const quote = state.exchangeQuotes.find((item) => item.target === target)!;
  if (quantity > quote.remainingQuantity) throw new AppError('WEEKLY_LIMIT', '本周兑换额度不足。');
  return {
    target,
    quantity,
    goldCost: weeklyExchangeCost(target, quote.soldQuantity, quantity),
    quote,
    balances: await balancesOf(playerId),
    serverTime: new Date().toISOString(),
  };
}

type RouteAssistantSettings = {
  isAutoTravelEnabled: boolean;
  isPartyAllMembersUnlockedOnly: boolean;
  isPartySummonAllowed: boolean;
  isAutoBaitEnabled: boolean;
  isAutoCheckInEnabled: boolean;
  statAllocationAutomation: { isEnabled: boolean; stat: string };
  isAutoWorldBossRegistrationEnabled: boolean;
  isAutoArcaneSacrificeEnabled: boolean;
  arcaneSacrificeTargetByResource: Record<string, unknown>;
  arcaneSacrificeFishRarities: string[];
  experienceBuffAutomation: Record<string, unknown>;
  priorities: string[];
  baitByScene: Record<string, unknown>;
};

const defaultRouteAssistantSettings: RouteAssistantSettings = {
  isAutoTravelEnabled: true,
  isPartyAllMembersUnlockedOnly: true,
  isPartySummonAllowed: true,
  isAutoBaitEnabled: true,
  isAutoCheckInEnabled: true,
  statAllocationAutomation: { isEnabled: false, stat: 'strength' },
  isAutoWorldBossRegistrationEnabled: true,
  isAutoArcaneSacrificeEnabled: false,
  arcaneSacrificeTargetByResource: { fish: 100, gold: 100, relic: 100 },
  arcaneSacrificeFishRarities: ['common', 'uncommon', 'fine', 'rare'],
  experienceBuffAutomation: {
    relic: { isEnabled: false, productId: 'relic-xp-i', purchaseMode: 'always', minimumBalance: 0 },
    fragment: { isEnabled: false, purchaseMode: 'always', minimumBalance: 0 },
    guild: { isEnabled: false, activationMode: 'always', minimumTreasuryGold: 0 },
  },
  priorities: ['competition', 'golden', 'experience'],
  baitByScene: { personalCompetition: null, guildCompetition: null, golden: null, arcaneSurge: null, normal: null },
};

async function loadRouteSettings(playerId: string): Promise<RouteAssistantSettings> {
  const row = (await db.select().from(schema.globalSettings).where(eq(schema.globalSettings.key, `routeAssistantSettings:${playerId}`)))[0];
  return { ...defaultRouteAssistantSettings, ...(row?.value && typeof row.value === 'object' ? row.value as Partial<RouteAssistantSettings> : {}) };
}

async function upsertSetting(key: string, value: unknown) {
  await db.insert(schema.globalSettings).values({ key, value }).onConflictDoUpdate({ target: schema.globalSettings.key, set: { value, updatedAt: new Date() } });
}

async function convenienceState(playerId: string) {
  const [entitlements, enabledRow, settings, player] = await Promise.all([
    db.select().from(schema.convenienceEntitlements).where(eq(schema.convenienceEntitlements.playerId, playerId)),
    db.select().from(schema.globalSettings).where(eq(schema.globalSettings.key, `routeAssistant:${playerId}`)),
    loadRouteSettings(playerId),
    db.select().from(schema.players).where(eq(schema.players.id, playerId)),
  ]);
  const entMap = new Map(entitlements.map((item) => [item.productId, item]));
  const products = [
    { id: 'unlimited-online-fishing', name: '在线畅钓', description: '在线结算的每一杆不再消耗当前批次钓鱼次数。灯塔点亮期间全服免费，已购时长暂停消耗。', purchaseOptions: [{ durationDays: 1, durationSeconds: 86400, price: 100 }, { durationDays: 30, durationSeconds: 2592000, price: 1000 }] },
    { id: 'route-assistant', name: '航线助手', description: '在网页保持在线时自动处理航线、鱼饵、签到和已开启的世界事件。', purchaseOptions: [{ durationDays: 1, durationSeconds: 86400, price: 100 }, { durationDays: 30, durationSeconds: 2592000, price: 1000 }] },
  ];
  const routeEntitlement = entMap.get('route-assistant');
  const routeOwned = !!routeEntitlement?.isActive && !!routeEntitlement.endsAt && routeEntitlement.endsAt > new Date();
  return {
    products,
    entitlements: Object.fromEntries(products.map((product) => {
      const entitlement = entMap.get(product.id);
      return [product.id, { productId: product.id, isActive: !!entitlement?.isActive && !!entitlement.endsAt && entitlement.endsAt > new Date(), endsAt: entitlement?.endsAt?.toISOString() ?? null }];
    })),
    routeAssistant: {
      isEnabled: enabledRow[0]?.value === true,
      isOperational: routeOwned,
      settings,
      occupancy: { scope: 'personal', canControlPartyTravel: false, occupant: null, isCurrentPlayer: false, nextRefreshAt: null },
      allPartyMembersUnlockedBiomeIds: null,
      dailyCheckInPlan: { chinaDate: chinaDate(), scheduledAt: null },
    },
    balances: {
      gold: player[0]?.gold ?? 0,
      relics: player[0]?.relics ?? 0,
      fragments: player[0]?.fragments ?? 0,
    },
    serverTime: new Date().toISOString(),
  };
}

async function balancesOf(playerId: string) {
  const p = (await db.select().from(schema.players).where(eq(schema.players.id, playerId)))[0];
  return { gold: p.gold, relics: p.relics, fragments: p.fragments };
}

async function dailyCheckInState(playerId: string) {
  const today = chinaDate();
  const rows = await db.select().from(schema.dailyCheckIns).where(eq(schema.dailyCheckIns.playerId, playerId)).orderBy(desc(schema.dailyCheckIns.claimedAt));
  const last = rows[0];
  const checkedToday = !!last && last.date === today;
  let cycleIndex = 1;
  let rewardDay = 1;
  if (last) {
    const lastDate = new Date(`${last.date}T00:00:00+08:00`);
    const todayDate = new Date(`${today}T00:00:00+08:00`);
    const diffDays = Math.round((todayDate.getTime() - lastDate.getTime()) / 86400000);
    if (diffDays <= 1 && !checkedToday) {
      cycleIndex = last.cycleIndex % 7 + 1;
      rewardDay = (last.rewardDay % 7) + 1;
    } else if (diffDays === 1 && checkedToday) {
      cycleIndex = last.cycleIndex + 1;
    }
  }
  const rewards = [
    { dayIndex: 1, gold: 100000, relics: 50, fragments: 0, chest: null },
    { dayIndex: 2, gold: 100000, relics: 0, fragments: 10, chest: null },
    { dayIndex: 3, gold: 0, relics: 0, fragments: 0, chest: { definitionId: 'magic_gear_chest', name: '魔法宝箱', quantity: 1 } },
    { dayIndex: 4, gold: 0, relics: 200, fragments: 0, chest: null },
    { dayIndex: 5, gold: 0, relics: 0, fragments: 0, chest: { definitionId: 'mysterious_gear_chest', name: '神话宝箱', quantity: 1 } },
    { dayIndex: 6, gold: 0, relics: 0, fragments: 25, chest: null },
    { dayIndex: 7, gold: 0, relics: 0, fragments: 0, chest: { definitionId: 'arcane_gear_chest', name: '奥术宝箱', quantity: 1 } },
  ].map((reward) => ({ ...reward, status: checkedToday && reward.dayIndex === rewardDay ? 'claimed' : last && reward.dayIndex <= last.rewardDay ? 'claimed' : 'locked' }));
  return {
    currentStreak: checkedToday ? cycleIndex : last ? last.cycleIndex : 0,
    longestStreak: rows.length,
    totalCheckIns: rows.length,
    progressInCycle: checkedToday ? cycleIndex : 0,
    nextRewardDay: rewardDay,
    checkedInToday: checkedToday,
    canClaim: !checkedToday,
    rewards,
    chinaDate: today,
    nextResetAt: nextChinaMidnight().toISOString(),
    serverTime: new Date().toISOString(),
  };
}

function buffPublic(b: any) {
  return {
    id: b.id,
    source: b.source ?? 'player_shop',
    buffType: b.buffType,
    displayTag: b.buffType === 'experience' ? '经验加成' : b.buffType === 'gold' ? '金币加成' : `${b.buffType}加成`,
    displayDescription: '',
    bonusBasisPoints: b.bonusBasisPoints,
    startsAt: b.startsAt?.toISOString() ?? null,
    endsAt: b.endsAt?.toISOString() ?? null,
    status: b.endsAt && b.endsAt > new Date() ? 'active' : 'queued',
    purchaser: null,
  };
}

function nextChinaMidnight(): Date {
  const now = new Date();
  const china = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const midnight = new Date(Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate() + 1, 0, 0, 0));
  return new Date(midnight.getTime() - 8 * 60 * 60 * 1000);
}
