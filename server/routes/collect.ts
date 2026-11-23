import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../app.js';
import { engagementFrom } from '../app.js';
import { badRequest, h, notFound } from '../lib/http.js';
import { cancelScan, hydrateRun, NMAP_LIMITS, NMAP_PROFILES, nmapInfo, planScan, startScan, type NmapProfile } from '../services/nmapRunner.js';
import { snapshotCommands, takeHostSnapshot } from '../services/hostSnapshot.js';
import { cancelAutopilot, hydrateAutopilot, readiness, startAutopilot } from '../services/autopilot.js';
import { applyExposureRules, EXPOSURE_RULES } from '../services/exposureRules.js';
import { logActivity } from '../lib/activity.js';
import { ALLOWED_INTERVALS, createSchedule, deleteSchedule, hydrateSchedule, MAX_SCHEDULE_DAYS, setScheduleEnabled } from '../services/scanScheduler.js';

const planSchema = z
  .object({
    target: z.string().trim().min(1).max(200),
    profile: z.enum(Object.keys(NMAP_PROFILES) as [NmapProfile, ...NmapProfile[]]),
    skip_discovery: z.boolean().optional(),
  })
  .strict();

/** In-app collection: scope-restricted Nmap runs and a read-only local host snapshot. */
export default function collectRoutes(ctx: Ctx) {
  const r = Router({ mergeParams: true });
  const { db } = ctx;

  r.get('/scan-runs/capability', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const info = nmapInfo(ctx, req.query.refresh === '1');
    const scope = db.all('SELECT id, kind, target, target_type, confirmed FROM scope_entries WHERE engagement_id = ? ORDER BY kind, created_at', eng.id);
    res.json({
      nmap: { available: !!info.path, version: info.version },
      platform: process.platform,
      is_demo: !!eng.is_demo,
      window: { start: eng.window_start, end: eng.window_end },
      targets: scope.filter((s) => s.kind === 'in'),
      exclusions: scope.filter((s) => s.kind === 'out'),
      profiles: Object.entries(NMAP_PROFILES).map(([key, p]) => ({ key, label: p.label, description: p.description, args: p.args })),
      limits: { max_hosts: NMAP_LIMITS.maxHosts, timeout_minutes: NMAP_LIMITS.timeoutMs / 60_000 },
      running: db.get("SELECT id, code FROM scan_runs WHERE status = 'running' LIMIT 1") ?? null,
      host_snapshot_commands: snapshotCommands().map((c) => [c.bin, ...c.args].join(' ')),
    });
  }));

  r.post('/scan-runs/plan', h(async (req, res) => {
    const eng = engagementFrom(ctx, req);
    const b = planSchema.parse(req.body);
    res.json(await planScan(ctx, eng, b.target, b.profile, !!b.skip_discovery));
  }));

  r.post('/scan-runs', h(async (req, res) => {
    const eng = engagementFrom(ctx, req);
    const b = planSchema.extend({ confirm: z.literal(true) }).parse(req.body);
    // The plan is rebuilt here from the database; nothing the browser previewed is trusted.
    const plan = await planScan(ctx, eng, b.target, b.profile, !!b.skip_discovery);
    res.status(202).json(startScan(ctx, eng, plan));
  }));

  r.get('/scan-runs', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const rows = db.all(
      `SELECT r.*, si.code AS scan_import_code, e.code AS evidence_code FROM scan_runs r
       LEFT JOIN scan_imports si ON si.id = r.scan_import_id LEFT JOIN evidence e ON e.id = r.evidence_id
       WHERE r.engagement_id = ? ORDER BY r.started_at DESC LIMIT 200`,
      eng.id,
    );
    res.json(rows.map(hydrateRun));
  }));

  r.get('/scan-runs/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const row = db.get(
      `SELECT r.*, si.code AS scan_import_code, e.code AS evidence_code FROM scan_runs r
       LEFT JOIN scan_imports si ON si.id = r.scan_import_id LEFT JOIN evidence e ON e.id = r.evidence_id
       WHERE r.engagement_id = ? AND (r.id = ? OR r.code = ?)`,
      eng.id, req.params.id, req.params.id,
    );
    if (!row) throw notFound('Scan run');
    res.json(hydrateRun(row));
  }));

  r.post('/scan-runs/:id/cancel', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    cancelScan(ctx, eng, req.params.id);
    res.json({ ok: true });
  }));

  // ---------- automatic schedules ----------
  r.get('/scan-schedules', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const rows = db.all(
      `SELECT s.*, r.code AS last_run_code, r.status AS last_run_status FROM scan_schedules s LEFT JOIN scan_runs r ON r.id = s.last_run_id
       WHERE s.engagement_id = ? ORDER BY s.enabled DESC, s.created_at DESC`,
      eng.id,
    );
    res.json({ schedules: rows.map(hydrateSchedule), intervals: ALLOWED_INTERVALS, max_days: MAX_SCHEDULE_DAYS });
  }));

  r.post('/scan-schedules', h(async (req, res) => {
    const eng = engagementFrom(ctx, req);
    const b = planSchema
      .extend({ confirm: z.literal(true), interval_minutes: z.number().int(), ends_at: z.string().max(40).nullable().optional(), run_now: z.boolean().optional() })
      .parse(req.body);
    res.status(201).json(await createSchedule(ctx, eng, b));
  }));

  r.patch('/scan-schedules/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const b = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    res.json(setScheduleEnabled(ctx, eng, req.params.id, b.enabled));
  }));

  r.delete('/scan-schedules/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    deleteSchedule(ctx, eng, req.params.id);
    res.json({ ok: true });
  }));

  // ---------- Autopilot ----------
  r.get('/autopilot', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const runs = db.all('SELECT * FROM autopilot_runs WHERE engagement_id = ? ORDER BY started_at DESC LIMIT 10', eng.id).map(hydrateAutopilot);
    res.json({
      readiness: readiness(ctx, eng),
      runs,
      rules: EXPOSURE_RULES.map((r) => ({ key: r.key, title: r.title, severity: r.severity, ports: r.ports })),
    });
  }));

  r.get('/autopilot/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const row = db.get('SELECT * FROM autopilot_runs WHERE engagement_id = ? AND id = ?', eng.id, req.params.id);
    if (!row) throw notFound('Autopilot run');
    res.json(hydrateAutopilot(row));
  }));

  r.post('/autopilot', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const b = z
      .object({
        profile: z.enum(['quick', 'standard']).default('quick'),
        retry_without_ping: z.boolean().default(true),
        analyze: z.boolean().default(true),
        host_snapshot: z.boolean().default(false),
        confirm: z.literal(true),
      })
      .strict()
      .parse(req.body);
    const { confirm: _c, ...options } = b;
    res.status(202).json(startAutopilot(ctx, eng, options));
  }));

  r.post('/autopilot/:id/cancel', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    cancelAutopilot(ctx, eng, req.params.id);
    res.json({ ok: true });
  }));

  r.post('/exposure-rules/apply', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    if (eng.is_demo) throw badRequest('Rules are not applied to the demo engagement.');
    const out = applyExposureRules(ctx, eng);
    logActivity(db, eng.id, 'exposure_rules.applied', 'finding', `Exposure rules raised ${out.created.length} finding(s) to verify`, {});
    res.json(out);
  }));

  r.post('/host-snapshot', h(async (req, res) => {
    const eng = engagementFrom(ctx, req);
    if (req.body?.confirm !== true) throw badRequest('Confirm that this computer may be examined for this engagement.');
    res.status(201).json(await takeHostSnapshot(ctx, eng));
  }));

  return r;
}
