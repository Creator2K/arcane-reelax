import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { handleError } from './util/errors.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerContentRoutes } from './routes/content.js';
import { registerPlayerRoutes } from './routes/player.js';
import { registerFishingRoutes } from './routes/fishing.js';
import { registerInventoryRoutes } from './routes/inventory.js';
import { registerProgressionRoutes } from './routes/progression.js';
import { registerShopRoutes } from './routes/shop.js';
import { registerMarketRoutes } from './routes/market.js';
import { registerSocialRoutes } from './routes/social.js';
import { registerCompetitionRoutes } from './routes/competition.js';
import { registerLeaderboardsRoutes } from './routes/leaderboards.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerLighthouseRoutes } from './routes/lighthouse.js';
import { registerWorldBossRoutes } from './routes/worldBoss.js';
import { startScheduledJobs } from './services/jobs.js';
import { db } from './db/client.js';
import { sql } from 'drizzle-orm';

const PORT = Number(process.env.PORT || 3000);

export async function buildServer() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'warn' } });

  await app.register(cookie);
  const allowedOrigins = new Set([
    process.env.FRONTEND_ORIGIN,
    'http://localhost:5173', 'http://127.0.0.1:5173',
    'http://localhost:3000', 'http://127.0.0.1:3000',
  ].filter(Boolean) as string[]);
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || allowedOrigins.has(origin)),
    credentials: true,
  });
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    return payload;
  });

  const webDistDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  const staticDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../static');
  const publicRoot = fs.existsSync(path.join(webDistDir, 'index.html')) ? webDistDir : staticDir;
  await app.register(fastifyStatic, {
    root: publicRoot,
    prefix: '/',
    decorateReply: true,
  });

  app.setErrorHandler((e, req, reply) => {
    const { status, body } = handleError(e);
    reply.status(status).send(body);
  });

  app.get('/api/health', async () => {
    await db.execute(sql`SELECT 1`);
    return { status: 'ok', version: '0.26.1', serverTime: new Date().toISOString() };
  });

  await registerAuthRoutes(app);
  await registerContentRoutes(app);
  await registerPlayerRoutes(app);
  await registerFishingRoutes(app);
  await registerInventoryRoutes(app);
  await registerProgressionRoutes(app);
  await registerShopRoutes(app);
  await registerMarketRoutes(app);
  await registerSocialRoutes(app);
  await registerCompetitionRoutes(app);
  await registerLeaderboardsRoutes(app);
  await registerAdminRoutes(app);
  await registerLighthouseRoutes(app);
  await registerWorldBossRoutes(app);

  startScheduledJobs();

  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && req.url.startsWith('/admin') && fs.existsSync(path.join(webDistDir, 'admin.html'))) {
      return reply.sendFile('admin.html');
    }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && !req.url.startsWith('/api/') && !path.extname(pathname) && fs.existsSync(path.join(webDistDir, 'index.html'))) {
      return reply.sendFile('index.html');
    }
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: '请求的资源不存在。' } });
  });

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  buildServer().then((app) => {
    app.listen({ port: PORT, host: '0.0.0.0' }).then(() => {
      console.log(`Arcane Reelax server listening on :${PORT}`);
    });
  });
}
