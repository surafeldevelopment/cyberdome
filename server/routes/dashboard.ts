import { Router } from 'express';
import type { Ctx } from '../app.js';
import { engagementFrom } from '../app.js';
import { h } from '../lib/http.js';
import { dashboard } from '../services/metrics.js';

export default function dashboardRoutes(ctx: Ctx) {
  const r = Router({ mergeParams: true });
  r.get('/dashboard', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    res.json(dashboard(ctx.db, eng.id));
  }));
  return r;
}
