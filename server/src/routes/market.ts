import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { eq, and, sql, desc, asc, gt, lt, inArray } from 'drizzle-orm';
import { requireAuth } from '../services/auth.js';
import { AppError } from '../util/errors.js';
import { MARKET_CONFIG } from '../constants.js';
import { gearPublic, gearValue } from './inventory.js';
import { nextLevelExp } from './auth.js';
import { loadPlayerContext } from '../services/playerState.js';

const FEE_BP = MARKET_CONFIG.sellerFeeBasisPoints;

export async function registerMarketRoutes(app: FastifyInstance) {
  app.get('/api/market/config', async (req, reply) => {
    const active = await db.select({ count: sql<number>`count(*)::int` }).from(schema.marketOrders).where(eq(schema.marketOrders.status, 'active'));
    const minimums = [
      ['common', 7500], ['uncommon', 15000], ['fine', 25000], ['rare', 50000], ['epic', 100000],
      ['legendary', 200000], ['mythic', 400000], ['exotic', 10000000], ['arcane', 300000000],
    ] as const;
    const prices = minimums.map(([rarity, minimum]) => {
      const cumulativeUpgradeCosts = [0];
      for (let level = 1; level <= 10; level += 1) {
        cumulativeUpgradeCosts.push(cumulativeUpgradeCosts[level - 1] + Math.floor(minimum * Math.pow(1.75, level - 1)));
      }
      return {
        rarity,
        configuredBaseMinimumUnitPrice: ['mythic', 'exotic', 'arcane'].includes(rarity) ? minimum : null,
        effectiveBaseMinimumUnitPrice: minimum,
        cumulativeUpgradeCosts,
      };
    });
    return {
      ...MARKET_CONFIG,
      updatedAt: '2026-07-24T16:55:03.353Z',
      fishMinimumPrices: [],
      gearMinimumPrices: prices,
      magicStoneMinimumPrices: prices,
      activeOrderCount: Number(active[0]?.count ?? 0),
      serverTime: new Date().toISOString(),
    };
  });

  app.get('/api/market/reference-prices', async (req, reply) => {
    await requireAuth(req, reply);
    const [fishRows, gearRows] = await Promise.all([
      db.select().from(schema.fish),
      db.select().from(schema.gearItems),
    ]);
    return {
      fish: fishRows.map((fish) => ({ fishId: fish.id, groupType: 'global', referenceUnitPrice: fish.sellPrice, sampleCount: 0 })),
      gear: gearRows.slice(0, 100).map((gear) => ({ rarity: gear.rarity, qualityBand: null, normalizedReferenceUnitPrice: gearValue(gear), sampleCount: 0 })),
      statistics: { windowDays: 14, maximumSamplesPerGroup: 100, minimumSamples: 3, trimBasisPointsPerSide: 1000 },
      serverTime: new Date().toISOString(),
    };
  });

  app.get('/api/market/fish/overview', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const [fishDefs, inv, activeOrders, latestTrades] = await Promise.all([
      db.select().from(schema.fish),
      db.select().from(schema.playerInventoryFish).where(eq(schema.playerInventoryFish.playerId, player.id)),
      db.select().from(schema.marketOrders).where(eq(schema.marketOrders.status, 'active')),
      db.select().from(schema.marketTrades).where(gt(schema.marketTrades.createdAt, new Date(Date.now() - 24 * 3600 * 1000))),
    ]);
    const invMap = new Map(inv.map((i) => [i.fishId, i]));
    const orderMap = new Map<string, { sell: number; buy: number }>();
    for (const o of activeOrders) {
      if (!o.fishId) continue;
      const entry = orderMap.get(o.fishId) ?? { sell: 0, buy: 0 };
      if (o.side === 'sell') entry.sell += o.remainingQuantity;
      else entry.buy += o.remainingQuantity;
      orderMap.set(o.fishId, entry);
    }
    const tradeMap = new Map<string, { price: number; count: number; prev: number }>();
    for (const t of latestTrades) {
      if (!t.fishId) continue;
      const entry = tradeMap.get(t.fishId) ?? { price: 0, count: 0, prev: 0 };
      entry.price = t.unitPrice;
      entry.count += t.quantity;
      tradeMap.set(t.fishId, entry);
    }
    return {
      fish: fishDefs.map((f) => {
        const orders = orderMap.get(f.id);
        const trade = tradeMap.get(f.id);
        const holding = invMap.get(f.id);
        return {
          fishId: f.id,
          name: f.name,
          rarity: f.rarity,
          biomeId: f.biomeId,
          latestTradeUnitPrice: trade?.price ?? null,
          priceChange24hBasisPoints: 0,
          sellOrderQuantity: orders?.sell ?? 0,
          buyOrderQuantity: orders?.buy ?? 0,
          heldQuantity: holding?.quantity ?? 0,
          heldValue: (holding?.quantity ?? 0) * (trade?.price ?? f.sellPrice),
        };
      }).filter((f) => f.sellOrderQuantity > 0 || f.buyOrderQuantity > 0 || (f.heldQuantity ?? 0) > 0),
      serverTime: new Date().toISOString(),
    };
  });

  app.get('/api/market/fish/:fishId/order-book', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const fishId = String((req.params as any).fishId);
    const limit = Math.min(50, Number((req.query as any).limit ?? 20));
    const [fish, sells, buys, holding] = await Promise.all([
      db.select().from(schema.fish).where(eq(schema.fish.id, fishId)),
      db.select().from(schema.marketOrders).where(and(eq(schema.marketOrders.fishId, fishId), eq(schema.marketOrders.side, 'sell'), eq(schema.marketOrders.status, 'active'))).orderBy(asc(schema.marketOrders.limitUnitPrice)).limit(limit),
      db.select().from(schema.marketOrders).where(and(eq(schema.marketOrders.fishId, fishId), eq(schema.marketOrders.side, 'buy'), eq(schema.marketOrders.status, 'active'))).orderBy(desc(schema.marketOrders.limitUnitPrice)).limit(limit),
      db.select().from(schema.playerInventoryFish).where(and(eq(schema.playerInventoryFish.playerId, player.id), eq(schema.playerInventoryFish.fishId, fishId))),
    ]);
    if (!fish[0]) throw new AppError('FISH_NOT_FOUND', '鱼种不存在。', 404);
    const levels = (orders: typeof sells) => {
      const grouped = new Map<number, { unitPrice: number; quantity: number; orderCount: number; myOrderIds: string[] }>();
      for (const order of orders) {
        const row = grouped.get(order.limitUnitPrice) ?? { unitPrice: order.limitUnitPrice, quantity: 0, orderCount: 0, myOrderIds: [] };
        row.quantity += order.remainingQuantity;
        row.orderCount += 1;
        if (order.ownerId === player.id) row.myOrderIds.push(order.id);
        grouped.set(order.limitUnitPrice, row);
      }
      return [...grouped.values()];
    };
    return {
      version: Date.now(),
      fish: fish[0],
      holdingQuantity: holding[0]?.quantity ?? 0,
      buyLevels: levels(buys),
      sellLevels: levels(sells),
      nextBuyCursor: null,
      nextSellCursor: null,
      serverTime: new Date().toISOString(),
    };
  });

  app.post('/api/market/orders', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({
      assetType: z.enum(['fish', 'gear', 'item']),
      side: z.enum(['sell', 'buy']),
      fishId: z.string().optional(),
      gearId: z.string().optional(),
      itemType: z.string().optional(),
      itemId: z.string().optional(),
      quantity: z.number().int().min(1).max(100000),
      limitUnitPrice: z.number().int().min(1),
    }).parse(req.body as any);

    if (player.marketAccessStatus !== 'enabled') throw new AppError('MARKET_BANNED', '市场功能已被限制。');
    const activeCount = await db.select({ count: sql<number>`count(*)::int` }).from(schema.marketOrders).where(and(
      eq(schema.marketOrders.ownerId, player.id), eq(schema.marketOrders.status, 'active'),
    ));
    if (Number(activeCount[0]?.count ?? 0) >= MARKET_CONFIG.maxActiveOrdersPerPlayer) {
      throw new AppError('ORDER_LIMIT', '在售订单数量已达上限。');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + MARKET_CONFIG.orderDurationSeconds * 1000);

    // For sell orders: escrow asset
    if (body.side === 'sell') {
      if (body.assetType === 'fish') {
        if (!body.fishId) throw new AppError('VALIDATION_ERROR', '缺少鱼种。');
        const inv = (await db.select().from(schema.playerInventoryFish).where(and(
          eq(schema.playerInventoryFish.playerId, player.id), eq(schema.playerInventoryFish.fishId, body.fishId),
        )))[0];
        if (!inv || inv.quantity < body.quantity) throw new AppError('INSUFFICIENT_FISH', '鱼获数量不足。');
        if (inv.isLocked) throw new AppError('FISH_LOCKED', '已锁定的鱼无法上架。');
        const fishId = body.fishId!;
        await db.transaction(async (tx) => {
          await tx.update(schema.playerInventoryFish).set({ quantity: inv.quantity - body.quantity })
            .where(and(eq(schema.playerInventoryFish.playerId, player.id), eq(schema.playerInventoryFish.fishId, fishId)));
          await tx.insert(schema.marketOrders).values({
            ownerId: player.id, assetType: 'fish', side: 'sell', status: 'active',
            limitUnitPrice: body.limitUnitPrice, initialQuantity: body.quantity, remainingQuantity: body.quantity,
            feeBasisPoints: FEE_BP, fishId, createdAt: now, updatedAt: now, expiresAt,
          });
        });
      } else if (body.assetType === 'gear') {
        if (!body.gearId) throw new AppError('VALIDATION_ERROR', '缺少装备。');
        const gear = (await db.select().from(schema.gearItems).where(and(eq(schema.gearItems.id, body.gearId), eq(schema.gearItems.ownerId, player.id))))[0];
        if (!gear) throw new AppError('GEAR_NOT_FOUND', '装备不存在。');
        if (gear.isEquipped) throw new AppError('GEAR_EQUIPPED', '请先卸下装备。');
        if (gear.isMarketListed) throw new AppError('GEAR_LISTED', '装备已上架。');
        await db.transaction(async (tx) => {
          await tx.update(schema.gearItems).set({ isMarketListed: true }).where(eq(schema.gearItems.id, gear.id));
          await tx.insert(schema.marketOrders).values({
            ownerId: player.id, assetType: 'gear', side: 'sell', status: 'active',
            limitUnitPrice: body.limitUnitPrice, initialQuantity: 1, remainingQuantity: 1,
            feeBasisPoints: FEE_BP, gearId: gear.id, createdAt: now, updatedAt: now, expiresAt,
          });
        });
      } else if (body.assetType === 'item') {
        const itemType = body.itemId ?? body.itemType;
        if (!itemType) throw new AppError('VALIDATION_ERROR', '缺少道具类型。');
        const balances = (await db.select().from(schema.players).where(eq(schema.players.id, player.id)))[0];
        const has = itemType === 'relic' ? balances.relics : itemType === 'fragment' ? balances.fragments : 0;
        if (has < body.quantity) throw new AppError('INSUFFICIENT_ITEM', '道具数量不足。');
        await db.transaction(async (tx) => {
          await tx.update(schema.players).set({
            relics: itemType === 'relic' ? sql`${schema.players.relics} - ${body.quantity}` : schema.players.relics,
            fragments: itemType === 'fragment' ? sql`${schema.players.fragments} - ${body.quantity}` : schema.players.fragments,
          }).where(eq(schema.players.id, player.id));
          await tx.insert(schema.marketOrders).values({
            ownerId: player.id, assetType: 'item', side: 'sell', status: 'active',
            limitUnitPrice: body.limitUnitPrice, initialQuantity: body.quantity, remainingQuantity: body.quantity,
            feeBasisPoints: FEE_BP, itemType: body.itemId ?? body.itemType, createdAt: now, updatedAt: now, expiresAt,
          });
        });
      }
    } else {
      // buy order: escrow gold
      const escrow = body.limitUnitPrice * body.quantity;
      if (player.gold < escrow) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
      await db.transaction(async (tx) => {
        await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${escrow}` }).where(eq(schema.players.id, player.id));
        await tx.insert(schema.marketOrders).values({
          ownerId: player.id, assetType: body.assetType, side: 'buy', status: 'active',
          limitUnitPrice: body.limitUnitPrice, initialQuantity: body.quantity, remainingQuantity: body.quantity,
          feeBasisPoints: 0, fishId: body.fishId, gearId: null, itemType: body.itemId ?? body.itemType ?? null,
          escrowGold: escrow, createdAt: now, updatedAt: now, expiresAt,
        });
      });
    }

    await tryMatch(body.assetType);
    return { success: true, player: await marketPlayer(player.id), serverTime: new Date().toISOString() };
  });

  app.post('/api/market/orders/:orderId/cancel', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const orderId = String((req.params as any).orderId);
    const order = (await db.select().from(schema.marketOrders).where(and(eq(schema.marketOrders.id, orderId), eq(schema.marketOrders.ownerId, player.id))))[0];
    if (!order || order.status !== 'active') throw new AppError('ORDER_NOT_FOUND', '订单不存在或已完成。');

    await db.transaction(async (tx) => {
      await tx.update(schema.marketOrders).set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() }).where(eq(schema.marketOrders.id, order.id));
      if (order.side === 'buy') {
        const refund = order.escrowGold * (order.remainingQuantity / order.initialQuantity);
        await tx.update(schema.players).set({ gold: sql`${schema.players.gold} + ${Math.floor(refund)}` }).where(eq(schema.players.id, player.id));
      } else if (order.assetType === 'fish' && order.fishId) {
        await tx.update(schema.playerInventoryFish).set({ quantity: sql`${schema.playerInventoryFish.quantity} + ${order.remainingQuantity}` })
          .where(and(eq(schema.playerInventoryFish.playerId, player.id), eq(schema.playerInventoryFish.fishId, order.fishId)));
      } else if (order.assetType === 'gear' && order.gearId) {
        await tx.update(schema.gearItems).set({ isMarketListed: false }).where(eq(schema.gearItems.id, order.gearId));
      } else if (order.assetType === 'item' && order.itemType) {
        await tx.update(schema.players).set({
          relics: order.itemType === 'relic' ? sql`${schema.players.relics} + ${order.remainingQuantity}` : schema.players.relics,
          fragments: order.itemType === 'fragment' ? sql`${schema.players.fragments} + ${order.remainingQuantity}` : schema.players.fragments,
        }).where(eq(schema.players.id, player.id));
      }
    });
    return { success: true };
  });

  app.get('/api/market/orders', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const q = req.query as any;
    const assetType = String(q.assetType ?? 'fish');
    const side = String(q.side ?? 'sell');
    const limit = Math.min(50, Number(q.limit ?? 24));
    const excludeOwn = q.excludeOwn === 'true';
    const conds: any[] = [eq(schema.marketOrders.assetType, assetType), eq(schema.marketOrders.side, side), eq(schema.marketOrders.status, 'active')];
    if (q.fishId) conds.push(eq(schema.marketOrders.fishId, String(q.fishId)));
    if (excludeOwn) conds.push(sql`${schema.marketOrders.ownerId} != ${player.id}`);
    const sort = side === 'buy' ? desc(schema.marketOrders.limitUnitPrice) : asc(schema.marketOrders.limitUnitPrice);
    const orders = await db.select().from(schema.marketOrders).where(and(...conds)).orderBy(sort).limit(limit);
    return { orders: await orderPublicMany(orders, player.id), nextCursor: null, serverTime: new Date().toISOString() };
  });

  app.get('/api/market/me/orders', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const rows = await db.select().from(schema.marketOrders).where(and(
      eq(schema.marketOrders.ownerId, player.id),
      sql`${schema.marketOrders.status} = any('{active,filled,cancelled,expired}'::text[])`,
    )).orderBy(desc(schema.marketOrders.createdAt)).limit(50);
    return { orders: await orderPublicMany(rows, player.id), nextCursor: null, serverTime: new Date().toISOString() };
  });

  app.get('/api/market/me/trades', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const rows = await db.select().from(schema.marketTrades).where(and(
      sql`(${schema.marketTrades.sellerId} = ${player.id} OR ${schema.marketTrades.buyerId} = ${player.id})`,
    )).orderBy(desc(schema.marketTrades.createdAt)).limit(50);
    return { trades: rows.map(tradePublic), nextCursor: null };
  });

  app.get('/api/market/me/state', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const orders = await db.select().from(schema.marketOrders).where(eq(schema.marketOrders.ownerId, player.id));
    return {
      fishRevision: orders.filter((o) => o.assetType === 'fish').length,
      gearRevision: orders.filter((o) => o.assetType === 'gear').length,
      itemRevision: orders.filter((o) => o.assetType === 'item').length,
      latestMarketFishTradeAt: null,
      latestMarketGearTradeAt: null,
      latestMarketItemTradeAt: null,
      serverTime: new Date().toISOString(),
    };
  });

  app.get('/api/market/me/fish-holdings', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const rows = await db.select().from(schema.playerInventoryFish).where(and(eq(schema.playerInventoryFish.playerId, player.id), gt(schema.playerInventoryFish.quantity, 0)));
    return { fish: rows.map((row) => ({ fishId: row.fishId, quantity: row.quantity })), serverTime: new Date().toISOString() };
  });

  app.delete('/api/market/orders/:orderId', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const orderId = String((req.params as any).orderId);
    const order = (await db.select().from(schema.marketOrders).where(and(eq(schema.marketOrders.id, orderId), eq(schema.marketOrders.ownerId, player.id))))[0];
    if (!order || order.status !== 'active') throw new AppError('ORDER_NOT_FOUND', '订单不存在或已完成。');
    await db.transaction(async (tx) => {
      await tx.update(schema.marketOrders).set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() }).where(eq(schema.marketOrders.id, order.id));
      if (order.side === 'buy') {
        await tx.update(schema.players).set({ gold: sql`${schema.players.gold} + ${Math.floor(order.escrowGold * (order.remainingQuantity / order.initialQuantity))}` }).where(eq(schema.players.id, player.id));
      } else if (order.assetType === 'fish' && order.fishId) {
        await tx.update(schema.playerInventoryFish).set({ quantity: sql`${schema.playerInventoryFish.quantity} + ${order.remainingQuantity}` }).where(and(eq(schema.playerInventoryFish.playerId, player.id), eq(schema.playerInventoryFish.fishId, order.fishId)));
      } else if (order.assetType === 'gear' && order.gearId) {
        await tx.update(schema.gearItems).set({ isMarketListed: false }).where(eq(schema.gearItems.id, order.gearId));
      }
    });
    return { success: true };
  });

  app.post('/api/market/orders/:orderId/purchase', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const orderId = String((req.params as any).orderId);
    const order = (await db.select().from(schema.marketOrders).where(eq(schema.marketOrders.id, orderId)))[0];
    if (!order || order.status !== 'active' || order.side !== 'sell') throw new AppError('ORDER_NOT_FOUND', '订单不存在或不可购买。');
    if (order.ownerId === player.id) throw new AppError('OWN_ORDER', '不能购买自己的订单。');
    const quantity = Math.max(1, Math.min(order.remainingQuantity, Number((req.body as any)?.quantity ?? order.remainingQuantity)));
    const total = order.limitUnitPrice * quantity;
    if (player.gold < total) throw new AppError('INSUFFICIENT_GOLD', '金币不足。');
    const seller = (await db.select().from(schema.players).where(eq(schema.players.id, order.ownerId)))[0];
    if (!seller) throw new AppError('SELLER_NOT_FOUND', '卖家不存在。');
    const fee = Math.floor(total * order.feeBasisPoints / 10000);
    await db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} - ${total}` }).where(eq(schema.players.id, player.id));
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} + ${total - fee}` }).where(eq(schema.players.id, seller.id));
      if (order.assetType === 'gear' && order.gearId) {
        await tx.update(schema.gearItems).set({ ownerId: player.id, isMarketListed: false, isEquipped: false }).where(eq(schema.gearItems.id, order.gearId));
      } else if (order.assetType === 'fish' && order.fishId) {
        await tx.insert(schema.playerInventoryFish).values({ playerId: player.id, fishId: order.fishId, quantity, totalCaught: 0, lastCaughtAt: new Date() })
          .onConflictDoUpdate({ target: [schema.playerInventoryFish.playerId, schema.playerInventoryFish.fishId], set: { quantity: sql`${schema.playerInventoryFish.quantity} + ${quantity}` } });
      }
      await tx.insert(schema.marketTrades).values({ assetType: order.assetType, fishId: order.fishId, buyerId: player.id, sellerId: seller.id, quantity, unitPrice: order.limitUnitPrice, sellerOrderId: order.id });
      if (quantity >= order.remainingQuantity) await tx.update(schema.marketOrders).set({ status: 'completed', remainingQuantity: 0, updatedAt: new Date() }).where(eq(schema.marketOrders.id, order.id));
      else await tx.update(schema.marketOrders).set({ remainingQuantity: sql`${schema.marketOrders.remainingQuantity} - ${quantity}`, updatedAt: new Date() }).where(eq(schema.marketOrders.id, order.id));
    });
    return { success: true, player: await marketPlayer(player.id), serverTime: new Date().toISOString() };
  });

  app.post('/api/market/orders/:orderId/captcha-challenge', async (req, reply) => {
    await requireAuth(req, reply);
    return { required: false, provider: null, appId: null, aidEncrypted: null, aidEncryptedType: null, serverTime: new Date().toISOString() };
  });

  app.get('/api/market/fish/events', async (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    reply.raw.write(`event: ready\ndata: ${JSON.stringify({ type: 'ready', assetType: 'fish', serverTime: new Date().toISOString() })}\n\n`);
    const timer = setInterval(() => reply.raw.write(': keep-alive\n\n'), 20_000);
    req.raw.on('close', () => clearInterval(timer));
  });

  app.get('/api/barter/orders', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const q = req.query as any;
    const limit = Math.min(30, Number(q.limit ?? 20));
    const page = Math.max(1, Number(q.page ?? 1));
    const conds: any[] = [eq(schema.barterOffers.status, 'active'), sql`${schema.barterOffers.ownerId} != ${player.id}`];
    if (q.onlyMyTargets === 'true') {
      // offers where wantFishId is in player's inventory
      const inv = await db.select().from(schema.playerInventoryFish).where(eq(schema.playerInventoryFish.playerId, player.id));
      const fishIds = inv.filter((i) => i.quantity > 0).map((i) => i.fishId);
      if (fishIds.length) conds.push(sql`${schema.barterOffers.wantFishId} = any(${fishIds})`);
      else return { items: [], nextCursor: null };
    }
    const rows = await db.select().from(schema.barterOffers).where(and(...conds)).orderBy(desc(schema.barterOffers.createdAt)).limit(limit).offset((page - 1) * limit);
    return { orders: rows.map(barterPublic), items: rows.map(barterPublic), nextCursor: null, serverTime: new Date().toISOString() };
  });

  app.post('/api/barter/orders', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const body = z.object({
      giveFishId: z.string(),
      wantFishId: z.string(),
      quantity: z.number().int().min(1).max(1000).default(1),
    }).parse(req.body as any);
    const [giveDef, wantDef] = await Promise.all([
      db.select().from(schema.fish).where(eq(schema.fish.id, body.giveFishId)),
      db.select().from(schema.fish).where(eq(schema.fish.id, body.wantFishId)),
    ]);
    if (!giveDef[0] || !wantDef[0]) throw new AppError('FISH_NOT_FOUND', '鱼种不存在。');
    for (const d of [giveDef[0], wantDef[0]]) {
      const idx = ['common', 'uncommon', 'fine', 'rare', 'epic', 'legendary', 'mythic', 'exotic', 'arcane'].indexOf(d.rarity);
      if (idx < 6) throw new AppError('RARITY_REQUIRED', '仅限神话、奇异、奥秘鱼进行交换。');
    }
    if (giveDef[0].rarity !== wantDef[0].rarity) throw new AppError('RARITY_MISMATCH', '只能同稀有度一比一交换。');
    const inv = (await db.select().from(schema.playerInventoryFish).where(and(
      eq(schema.playerInventoryFish.playerId, player.id), eq(schema.playerInventoryFish.fishId, body.giveFishId),
    )))[0];
    if (!inv || inv.quantity < body.quantity) throw new AppError('INSUFFICIENT_FISH', '鱼获数量不足。');

    await db.transaction(async (tx) => {
      await tx.update(schema.playerInventoryFish).set({ quantity: inv.quantity - body.quantity })
        .where(and(eq(schema.playerInventoryFish.playerId, player.id), eq(schema.playerInventoryFish.fishId, body.giveFishId)));
      await tx.insert(schema.barterOffers).values({
        ownerId: player.id, giveFishId: body.giveFishId, wantFishId: body.wantFishId,
        quantity: body.quantity, expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      });
    });
    return { success: true, serverTime: new Date().toISOString() };
  });

  app.post('/api/barter/orders/:offerId/accept', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const offerId = String((req.params as any).offerId);
    const offer = (await db.select().from(schema.barterOffers).where(eq(schema.barterOffers.id, offerId)))[0];
    if (!offer || offer.status !== 'active') throw new AppError('OFFER_NOT_FOUND', '交换单不存在或已关闭。');
    if (offer.ownerId === player.id) throw new AppError('SELF_TRADE', '不能交换自己的订单。');

    const [wantInv, giveInv] = await Promise.all([
      db.select().from(schema.playerInventoryFish).where(and(eq(schema.playerInventoryFish.playerId, player.id), eq(schema.playerInventoryFish.fishId, offer.wantFishId))),
      db.select().from(schema.playerInventoryFish).where(and(eq(schema.playerInventoryFish.playerId, offer.ownerId), eq(schema.playerInventoryFish.fishId, offer.giveFishId))),
    ]);
    if (!wantInv[0] || wantInv[0].quantity < offer.quantity) throw new AppError('INSUFFICIENT_FISH', '你的鱼获数量不足。');

    await db.transaction(async (tx) => {
      await tx.update(schema.playerInventoryFish).set({ quantity: wantInv[0].quantity - offer.quantity })
        .where(and(eq(schema.playerInventoryFish.playerId, player.id), eq(schema.playerInventoryFish.fishId, offer.wantFishId)));
      await tx.insert(schema.playerInventoryFish).values({ playerId: player.id, fishId: offer.giveFishId, quantity: offer.quantity })
        .onConflictDoUpdate({ target: [schema.playerInventoryFish.playerId, schema.playerInventoryFish.fishId], set: { quantity: sql`${schema.playerInventoryFish.quantity} + ${offer.quantity}` } });
      // give giver the wanted fish
      await tx.insert(schema.playerInventoryFish).values({ playerId: offer.ownerId, fishId: offer.wantFishId, quantity: offer.quantity })
        .onConflictDoUpdate({ target: [schema.playerInventoryFish.playerId, schema.playerInventoryFish.fishId], set: { quantity: sql`${schema.playerInventoryFish.quantity} + ${offer.quantity}` } });
      await tx.update(schema.barterOffers).set({ status: 'accepted', acceptedAt: new Date() }).where(eq(schema.barterOffers.id, offer.id));
      await tx.insert(schema.barterTrades).values({
        offerId: offer.id, giverId: offer.ownerId, receiverId: player.id,
        giveFishId: offer.giveFishId, wantFishId: offer.wantFishId, quantity: offer.quantity,
      });
    });
    return { success: true, serverTime: new Date().toISOString() };
  });

  app.post('/api/barter/orders/:offerId/cancel', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const offerId = String((req.params as any).offerId);
    const offer = (await db.select().from(schema.barterOffers).where(and(eq(schema.barterOffers.id, offerId), eq(schema.barterOffers.ownerId, player.id))))[0];
    if (!offer || offer.status !== 'active') throw new AppError('OFFER_NOT_FOUND', '交换单不存在。');
    await db.transaction(async (tx) => {
      await tx.update(schema.barterOffers).set({ status: 'cancelled', cancelledAt: new Date() }).where(eq(schema.barterOffers.id, offer.id));
      await tx.update(schema.playerInventoryFish).set({ quantity: sql`${schema.playerInventoryFish.quantity} + ${offer.quantity}` })
        .where(and(eq(schema.playerInventoryFish.playerId, player.id), eq(schema.playerInventoryFish.fishId, offer.giveFishId)));
    });
    return { success: true };
  });

  app.post('/api/barter/orders/:offerId/fill', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const offerId = String((req.params as any).offerId);
    const offer = (await db.select().from(schema.barterOffers).where(eq(schema.barterOffers.id, offerId)))[0];
    if (!offer || offer.status !== 'active') throw new AppError('OFFER_NOT_FOUND', '交换单不存在或已关闭。');
    if (offer.ownerId === player.id) throw new AppError('SELF_TRADE', '不能交换自己的订单。');
    const inventory = (await db.select().from(schema.playerInventoryFish).where(and(eq(schema.playerInventoryFish.playerId, player.id), eq(schema.playerInventoryFish.fishId, offer.wantFishId))))[0];
    if (!inventory || inventory.quantity < offer.quantity) throw new AppError('INSUFFICIENT_FISH', '你的鱼获数量不足。');
    await db.transaction(async (tx) => {
      await tx.update(schema.playerInventoryFish).set({ quantity: inventory.quantity - offer.quantity }).where(and(eq(schema.playerInventoryFish.playerId, player.id), eq(schema.playerInventoryFish.fishId, offer.wantFishId)));
      await tx.insert(schema.playerInventoryFish).values({ playerId: player.id, fishId: offer.giveFishId, quantity: offer.quantity }).onConflictDoUpdate({ target: [schema.playerInventoryFish.playerId, schema.playerInventoryFish.fishId], set: { quantity: sql`${schema.playerInventoryFish.quantity} + ${offer.quantity}` } });
      await tx.insert(schema.playerInventoryFish).values({ playerId: offer.ownerId, fishId: offer.wantFishId, quantity: offer.quantity }).onConflictDoUpdate({ target: [schema.playerInventoryFish.playerId, schema.playerInventoryFish.fishId], set: { quantity: sql`${schema.playerInventoryFish.quantity} + ${offer.quantity}` } });
      await tx.update(schema.barterOffers).set({ status: 'accepted', acceptedAt: new Date() }).where(eq(schema.barterOffers.id, offer.id));
      await tx.insert(schema.barterTrades).values({ offerId: offer.id, giverId: offer.ownerId, receiverId: player.id, giveFishId: offer.giveFishId, wantFishId: offer.wantFishId, quantity: offer.quantity });
    });
    return { success: true, serverTime: new Date().toISOString() };
  });

  app.delete('/api/barter/orders/:offerId', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const offerId = String((req.params as any).offerId);
    const offer = (await db.select().from(schema.barterOffers).where(and(eq(schema.barterOffers.id, offerId), eq(schema.barterOffers.ownerId, player.id))))[0];
    if (!offer || offer.status !== 'active') throw new AppError('OFFER_NOT_FOUND', '交换单不存在或已关闭。');
    await db.transaction(async (tx) => {
      await tx.update(schema.playerInventoryFish).set({ quantity: sql`${schema.playerInventoryFish.quantity} + ${offer.quantity}` }).where(and(eq(schema.playerInventoryFish.playerId, player.id), eq(schema.playerInventoryFish.fishId, offer.giveFishId)));
      await tx.update(schema.barterOffers).set({ status: 'cancelled', cancelledAt: new Date() }).where(eq(schema.barterOffers.id, offer.id));
    });
    return { success: true };
  });

  app.get('/api/market/items/:itemId/order-book', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const itemId = String((req.params as any).itemId);
    const rows = await db.select().from(schema.marketOrders).where(and(eq(schema.marketOrders.assetType, 'item'), eq(schema.marketOrders.itemType, itemId), eq(schema.marketOrders.status, 'active')));
    const levels = (side: 'buy' | 'sell') => {
      const grouped = new Map<number, { unitPrice: number; quantity: number }>();
      for (const row of rows.filter((item) => item.side === side)) {
        const level = grouped.get(row.limitUnitPrice) ?? { unitPrice: row.limitUnitPrice, quantity: 0 };
        level.quantity += row.remainingQuantity;
        grouped.set(row.limitUnitPrice, level);
      }
      return [...grouped.values()].sort((a, b) => side === 'buy' ? b.unitPrice - a.unitPrice : a.unitPrice - b.unitPrice);
    };
    return {
      version: Date.now(),
      item: itemDefinition(itemId),
      holdingQuantity: 0,
      buyLevels: levels('buy'),
      sellLevels: levels('sell'),
      nextBuyCursor: null,
      nextSellCursor: null,
      serverTime: new Date().toISOString(),
    };
  });

  app.get('/api/barter/me/orders', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const rows = await db.select().from(schema.barterOffers).where(eq(schema.barterOffers.ownerId, player.id)).orderBy(desc(schema.barterOffers.createdAt)).limit(50);
    return { orders: rows.map(barterPublic), items: rows.map(barterPublic), nextCursor: null };
  });

  app.get('/api/barter/me/trades', async (req, reply) => {
    const player = await requireAuth(req, reply);
    const rows = await db.select().from(schema.barterTrades).where(and(
      sql`(${schema.barterTrades.giverId} = ${player.id} OR ${schema.barterTrades.receiverId} = ${player.id})`,
    )).orderBy(desc(schema.barterTrades.createdAt)).limit(50);
    return { trades: rows.map((t) => ({ id: t.id, giveFishId: t.giveFishId, wantFishId: t.wantFishId, quantity: t.quantity, createdAt: t.createdAt.toISOString() })), items: rows.map((t) => ({ id: t.id, giveFishId: t.giveFishId, wantFishId: t.wantFishId, quantity: t.quantity, createdAt: t.createdAt.toISOString() })), nextCursor: null };
  });
}

const ITEM_DEFINITIONS: Record<string, { itemId: string; name: string; description: string; imagePath: string; marketSellerFeeBasisPoints: number; category: string }> = {
  furnace_carbon: { itemId: 'furnace_carbon', name: '炉岩碳', description: '用于魔法石升阶与单槽重随。永烬炉海与回环岁海的神器掉落事件分别产出 10 / 12 份，可在道具市场交易。', imagePath: '/items/furnace-carbon.webp', marketSellerFeeBasisPoints: 1500, category: 'material' },
  legendary_gear_crystal: { itemId: 'legendary_gear_crystal', name: '传说结晶', description: '分解同档装备获得，用于装备破限与魔法石培养，可在道具市场交易。', imagePath: '/items/legendary-gear-crystal.webp', marketSellerFeeBasisPoints: 1500, category: 'material' },
  mythic_gear_crystal: { itemId: 'mythic_gear_crystal', name: '神话结晶', description: '分解同档装备获得，用于装备破限与魔法石培养，可在道具市场交易。', imagePath: '/items/mythic-gear-crystal.webp', marketSellerFeeBasisPoints: 1500, category: 'material' },
  exotic_gear_crystal: { itemId: 'exotic_gear_crystal', name: '奇异结晶', description: '分解同档装备获得，用于装备破限与魔法石培养，可在道具市场交易。', imagePath: '/items/exotic-gear-crystal.webp', marketSellerFeeBasisPoints: 1500, category: 'material' },
  relic_fragment_gift_box: { itemId: 'relic_fragment_gift_box', name: '遗物碎片礼盒', description: '开启后固定获得 800 遗物和 80 奥秘碎片。', imagePath: '/items/relic-fragment-gift-box.webp', marketSellerFeeBasisPoints: 1800, category: 'consumable' },
};

function itemDefinition(itemId: string) {
  return ITEM_DEFINITIONS[itemId] ?? { itemId, name: itemId, description: '', imagePath: '/fish/b_001_common_01.webp', marketSellerFeeBasisPoints: 1000, category: 'material' };
}

async function orderPublicMany(rows: (typeof schema.marketOrders.$inferSelect)[], currentPlayerId?: string) {
  const fishIds = [...new Set(rows.map((row) => row.fishId).filter((id): id is string => !!id))];
  const gearIds = [...new Set(rows.map((row) => row.gearId).filter((id): id is string => !!id))];
  const ownerIds = [...new Set(rows.map((row) => row.ownerId))];
  const [fishRows, gearRows, owners] = await Promise.all([
    fishIds.length ? db.select().from(schema.fish).where(inArray(schema.fish.id, fishIds)) : Promise.resolve([]),
    gearIds.length ? db.select().from(schema.gearItems).where(inArray(schema.gearItems.id, gearIds)) : Promise.resolve([]),
    ownerIds.length ? db.select().from(schema.players).where(inArray(schema.players.id, ownerIds)) : Promise.resolve([]),
  ]);
  const fishMap = new Map(fishRows.map((fish) => [fish.id, fish]));
  const gearMap = new Map(gearRows.map((gear) => [gear.id, gear]));
  const ownerMap = new Map(owners.map((owner) => [owner.id, owner]));
  return rows.map((order) => {
    const fish = order.fishId ? fishMap.get(order.fishId) : null;
    const gear = order.gearId ? gearMap.get(order.gearId) : null;
    const item = order.itemType ? itemDefinition(order.itemType) : null;
    return {
      id: order.id,
      ownerNickname: ownerMap.get(order.ownerId)?.nickname ?? '未知玩家',
      isOwnOrder: order.ownerId === currentPlayerId,
      assetType: order.assetType,
      side: order.side,
      status: order.status,
      limitUnitPrice: order.limitUnitPrice,
      initialQuantity: order.initialQuantity,
      remainingQuantity: order.remainingQuantity,
      grossFilled: order.grossFilled,
      feeCharged: order.feeCharged,
      feeBasisPoints: order.feeBasisPoints,
      escrow: {
        fishQuantity: order.side === 'sell' && order.assetType === 'fish' ? order.remainingQuantity : 0,
        itemQuantity: order.side === 'sell' && order.assetType === 'item' ? order.remainingQuantity : 0,
        gold: order.escrowGold,
        isGearLocked: order.assetType === 'gear',
      },
      asset: fish ? { type: 'fish', fish } : gear ? { type: 'gear', gear: gearPublic(gear) } : item ? { type: 'item', item } : null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      expiresAt: order.expiresAt.toISOString(),
      filledAt: order.filledAt?.toISOString() ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      expiredAt: order.status === 'expired' ? order.updatedAt.toISOString() : null,
    };
  });
}

async function marketPlayer(playerId: string) {
  const player = (await db.select().from(schema.players).where(eq(schema.players.id, playerId)))[0];
  const context = await loadPlayerContext(playerId);
  const title = player.equippedTitleId ? (await db.select().from(schema.titles).where(eq(schema.titles.id, player.equippedTitleId)))[0] : null;
  return {
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
    currentBiomeId: player.currentBiomeId,
    equippedRodId: player.equippedRodId,
    selectedBaitId: player.selectedBaitId,
    equippedTitle: title ? {
      id: title.id,
      name: title.name,
      description: title.description,
      imagePath: title.imagePath,
      style: title.textColor ? { textColor: title.textColor, backgroundColor: title.backgroundColor, borderColor: title.borderColor, borderEffect: title.borderEffect } : undefined,
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
  };
}

async function tryMatch(assetType: string) {
  const fishId = assetType === 'fish' ? undefined : undefined;
  void fishId;
  // simplified matching: cross a single order book per fish
  const books = await db.select({ fishId: schema.marketOrders.fishId })
    .from(schema.marketOrders)
    .where(and(eq(schema.marketOrders.assetType, assetType), eq(schema.marketOrders.status, 'active'), sql`${schema.marketOrders.fishId} is not null`))
    .groupBy(schema.marketOrders.fishId)
    .limit(10);
  for (const b of books) {
    if (!b.fishId) continue;
    await matchFishBook(b.fishId);
  }
}

async function matchFishBook(fishId: string) {
  for (let i = 0; i < 50; i++) {
    const [bestBuy, bestSell] = await Promise.all([
      db.select().from(schema.marketOrders).where(and(
        eq(schema.marketOrders.fishId, fishId), eq(schema.marketOrders.side, 'buy'), eq(schema.marketOrders.status, 'active'),
      )).orderBy(desc(schema.marketOrders.limitUnitPrice)).limit(1),
      db.select().from(schema.marketOrders).where(and(
        eq(schema.marketOrders.fishId, fishId), eq(schema.marketOrders.side, 'sell'), eq(schema.marketOrders.status, 'active'),
      )).orderBy(asc(schema.marketOrders.limitUnitPrice)).limit(1),
    ]);
    const buy = bestBuy[0];
    const sell = bestSell[0];
    if (!buy || !sell) break;
    if (sell.limitUnitPrice > buy.limitUnitPrice) break;
    const price = Math.round((sell.limitUnitPrice + buy.limitUnitPrice) / 2);
    const qty = Math.min(buy.remainingQuantity, sell.remainingQuantity);

    await db.transaction(async (tx) => {
      const sellBalance = qty * sell.limitUnitPrice;
      const buyRefund = (buy.limitUnitPrice - price) * qty;
      const fee = Math.floor(sellBalance * FEE_BP / 10000);
      const sellerNet = sellBalance - fee;

      await tx.update(schema.marketOrders).set({
        remainingQuantity: sell.remainingQuantity - qty,
        grossFilled: sell.grossFilled + sellBalance,
        feeCharged: sell.feeCharged + fee,
        status: sell.remainingQuantity - qty <= 0 ? 'filled' : 'active',
        filledAt: sell.remainingQuantity - qty <= 0 ? new Date() : undefined,
        updatedAt: new Date(),
      }).where(eq(schema.marketOrders.id, sell.id));
      await tx.update(schema.marketOrders).set({
        remainingQuantity: buy.remainingQuantity - qty,
        grossFilled: buy.grossFilled + sellBalance,
        status: buy.remainingQuantity - qty <= 0 ? 'filled' : 'active',
        filledAt: buy.remainingQuantity - qty <= 0 ? new Date() : undefined,
        updatedAt: new Date(),
      }).where(eq(schema.marketOrders.id, buy.id));

      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} + ${sellerNet}` }).where(eq(schema.players.id, sell.ownerId));
      await tx.update(schema.players).set({ gold: sql`${schema.players.gold} + ${buyRefund}` }).where(eq(schema.players.id, buy.ownerId));
      await tx.insert(schema.marketTrades).values({
        assetType: 'fish', fishId, unitPrice: price, quantity: qty,
        sellerId: sell.ownerId, buyerId: buy.ownerId,
        sellerOrderId: sell.id, buyerOrderId: buy.id,
      });
      // deliver fish to buyer
      await tx.insert(schema.playerInventoryFish).values({ playerId: buy.ownerId, fishId, quantity: qty })
        .onConflictDoUpdate({ target: [schema.playerInventoryFish.playerId, schema.playerInventoryFish.fishId], set: { quantity: sql`${schema.playerInventoryFish.quantity} + ${qty}` } });
    });
  }
}

function orderPublic(o: typeof schema.marketOrders.$inferSelect) {
  return {
    id: o.id,
    ownerNickname: '',
    isOwnOrder: false,
    assetType: o.assetType,
    side: o.side,
    status: o.status,
    limitUnitPrice: o.limitUnitPrice,
    initialQuantity: o.initialQuantity,
    remainingQuantity: o.remainingQuantity,
    grossFilled: o.grossFilled,
    feeCharged: o.feeCharged,
    feeBasisPoints: o.feeBasisPoints,
    escrow: { fishQuantity: 0, itemQuantity: 0, gold: o.escrowGold, isGearLocked: o.assetType === 'gear' },
    asset: null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    expiresAt: o.expiresAt.toISOString(),
    filledAt: o.filledAt?.toISOString() ?? null,
    cancelledAt: o.cancelledAt?.toISOString() ?? null,
    expiredAt: null,
  };
}

function tradePublic(t: typeof schema.marketTrades.$inferSelect) {
  return {
    id: t.id,
    assetType: t.assetType,
    fishId: t.fishId,
    unitPrice: t.unitPrice,
    quantity: t.quantity,
    sellerId: t.sellerId,
    buyerId: t.buyerId,
    createdAt: t.createdAt.toISOString(),
  };
}

function barterPublic(o: typeof schema.barterOffers.$inferSelect) {
  return {
    id: o.id,
    ownerId: o.ownerId,
    giveFishId: o.giveFishId,
    wantFishId: o.wantFishId,
    quantity: o.quantity,
    status: o.status,
    createdAt: o.createdAt.toISOString(),
    expiresAt: o.expiresAt.toISOString(),
  };
}
