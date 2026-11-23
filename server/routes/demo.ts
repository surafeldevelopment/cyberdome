import { Router } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Ctx } from '../app.js';
import { badRequest, h, notFound } from '../lib/http.js';
import { seedDemo } from '../services/demoSeed.js';
import { logActivity } from '../lib/activity.js';
import { createBackup } from '../scripts/backup-core.js';

export default function demoRoutes(ctx: Ctx) {
  const r = Router();

  /* ------------------------------------------------------------------
   * Backup: GET /api/backup → zip (consistent DB snapshot via VACUUM INTO,
   * all evidence files, manifest.json with SHA-256 of every file).
   * Restore is CLI-only (npm run restore) so a browser can never overwrite data.
   * ------------------------------------------------------------------ */
  r.get(
    '/backup',
    h(async (_req, res) => {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cyberdome-dl-')), `cyberdome-backup-${stamp}.zip`);
      const manifest = await createBackup(ctx.db, ctx.cfg, tmp);
      logActivity(ctx.db, null, 'backup.created', 'backup', `Downloaded backup (${manifest.files.length} files, schema v${manifest.schema_version})`);
      res.setHeader('X-Backup-Files', String(manifest.files.length));
      res.download(tmp, path.basename(tmp), () => fs.rmSync(path.dirname(tmp), { recursive: true, force: true }));
    }),
  );

  /* ------------------------------------------------------------------
   * DEMO ENGAGEMENT — isolated, clearly labeled synthetic dataset.
   * POST /api/demo/load builds it from samples/demo via the real import pipelines.
   * DELETE /api/demo removes it (and only it).
   * ------------------------------------------------------------------ */
  r.get('/demo', h((_req, res) => {
    const d = ctx.db.get('SELECT id, name, created_at FROM engagements WHERE is_demo = 1');
    res.json({ loaded: !!d, engagement: d ?? null });
  }));

  r.post('/demo/load', h(async (req, res) => {
    const result = await seedDemo(ctx, req.app as any);
    res.status(201).json(result);
  }));

  r.delete('/demo', h((req, res) => {
    const d = ctx.db.get('SELECT id, name FROM engagements WHERE is_demo = 1');
    if (!d) throw notFound('Demo engagement');
    if (req.body?.confirm !== true) throw badRequest('Confirm removal of the demo engagement.');
    ctx.db.run('DELETE FROM engagements WHERE id = ? AND is_demo = 1', d.id);
    fs.rmSync(path.join(ctx.cfg.evidenceDir, d.id), { recursive: true, force: true });
    logActivity(ctx.db, null, 'demo.removed', 'engagement', 'Removed the demo engagement and its synthetic evidence files');
    res.json({ ok: true });
  }));

  return r;
}
