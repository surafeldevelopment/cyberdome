import express, { type Request } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { Db } from './db/index.js';
import { loadConfig, type AppConfig } from './config.js';
import { errorHandler, HttpError, notFound } from './lib/http.js';
import { ensureBaseline } from './services/bootstrap.js';

import systemRoutes from './routes/system.js';
import engagementRoutes from './routes/engagements.js';
import evidenceRoutes from './routes/evidence.js';
import scanRoutes from './routes/scans.js';
import collectRoutes from './routes/collect.js';
import { applySavedAi } from './services/aiSettings.js';
import { markInterruptedRuns } from './services/nmapRunner.js';
import { markInterruptedAutopilot } from './services/autopilot.js';
import findingRoutes from './routes/findings.js';
import referenceRoutes from './routes/references.js';
import reconRoutes from './routes/recon.js';
import attackRoutes from './routes/attack.js';
import aiRoutes from './routes/ai.js';
import reportRoutes from './routes/reports.js';
import dashboardRoutes from './routes/dashboard.js';
import trackerRoutes from './routes/tracker.js';
import searchRoutes from './routes/search.js';
import demoRoutes from './routes/demo.js';

export interface Ctx {
  db: Db;
  cfg: AppConfig;
}

/** Load an engagement from :eid or throw 404. Every engagement-scoped route uses this. */
export function engagementFrom(ctx: Ctx, req: Request) {
  const eng = ctx.db.get('SELECT * FROM engagements WHERE id = ?', req.params.eid);
  if (!eng) throw notFound('Engagement');
  return eng;
}

export function createApp(overrides: Partial<AppConfig> = {}) {
  const cfg = loadConfig(overrides);
  fs.mkdirSync(cfg.evidenceDir, { recursive: true });
  const db = new Db(cfg.dbFile);
  db.migrate();
  ensureBaseline(db);
  applySavedAi(cfg);
  markInterruptedRuns({ db, cfg });
  markInterruptedAutopilot({ db, cfg });
  const ctx: Ctx = { db, cfg };

  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  // Local-only hardening: reject requests whose Host header is not loopback (DNS-rebinding guard).
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', ...(process.env.CYBERDOME_ALLOWED_HOSTS ?? '').split(',').filter(Boolean)]);
  app.use((req, res, next) => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (host && !allowedHosts.has(host)) return res.status(421).json({ error: 'Host not allowed. CyberDome only serves loopback requests by default.' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    next();
  });

  app.use(express.json({ limit: '5mb' }));

  // CSRF guard for a no-login local app: state-changing API calls must carry a custom header,
  // which browsers will not attach to cross-site form posts.
  app.use('/api', (req, _res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.get('x-cyberdome') !== '1')
      return next(new HttpError(403, 'Missing X-CyberDome request header.'));
    next();
  });

  app.use('/api', systemRoutes(ctx));
  app.use('/api', engagementRoutes(ctx));
  app.use('/api/engagements/:eid', evidenceRoutes(ctx));
  app.use('/api/engagements/:eid', scanRoutes(ctx));
  app.use('/api/engagements/:eid', collectRoutes(ctx));
  app.use('/api/engagements/:eid', findingRoutes(ctx));
  app.use('/api/engagements/:eid', reconRoutes(ctx));
  app.use('/api/engagements/:eid', attackRoutes(ctx));
  app.use('/api/engagements/:eid', aiRoutes(ctx));
  app.use('/api/engagements/:eid', reportRoutes(ctx));
  app.use('/api/engagements/:eid', dashboardRoutes(ctx));
  app.use('/api/engagements/:eid', trackerRoutes(ctx));
  app.use('/api/engagements/:eid', searchRoutes(ctx));
  app.use('/api', referenceRoutes(ctx));
  app.use('/api', demoRoutes(ctx));

  app.use('/api', (_req, _res, next) => next(notFound('API route')));

  // Serve the built frontend in production.
  const dist = path.resolve(process.env.CYBERDOME_DIST_DIR || path.join(process.cwd(), 'dist'));
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(
      express.static(dist, {
        index: false,
        setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
      }),
    );
    app.get('*', (_req, res) => {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'",
      );
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return { app, ctx };
}
