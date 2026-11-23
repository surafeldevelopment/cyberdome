import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../app.js';
import { engagementFrom } from '../app.js';
import { badRequest, h, notFound } from '../lib/http.js';
import { nowIso } from '../lib/codes.js';
import { logActivity, currentActor } from '../lib/activity.js';
import { computeLabs } from '../services/labs.js';
import { CHECKPOINTS, FINAL_DUE } from '../lib/constants.js';

export default function trackerRoutes(ctx: Ctx) {
  const r = Router({ mergeParams: true });
  const { db } = ctx;

  r.get('/tracker', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const shots = db.all(
      `SELECT s.*, e.code AS evidence_code, e.title AS evidence_title, e.status AS evidence_status, e.detected_type
       FROM screenshot_requirements s LEFT JOIN evidence e ON e.id = s.evidence_id WHERE s.engagement_id = ? ORDER BY s.lab, s.rowid`,
      eng.id,
    );
    const deliverables = db.all(
      'SELECT d.*, e.code AS evidence_code FROM deliverables d LEFT JOIN evidence e ON e.id = d.evidence_id WHERE d.engagement_id = ? ORDER BY d.rowid',
      eng.id,
    );
    res.json({ labs: computeLabs(db, eng.id), screenshots: shots, deliverables, checkpoints: CHECKPOINTS, final_due: FINAL_DUE, today: new Date().toISOString().slice(0, 10) });
  }));

  r.put('/tracker/screenshots/:sid', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const s = db.get('SELECT * FROM screenshot_requirements WHERE id = ? AND engagement_id = ?', req.params.sid, eng.id);
    if (!s) throw notFound('Screenshot requirement');
    const b = z.object({ evidence_id: z.string().nullable() }).strict().parse(req.body);
    if (b.evidence_id) {
      const ev = db.get('SELECT id, code, detected_type, source_category FROM evidence WHERE engagement_id = ? AND (id = ? OR code = ?)', eng.id, b.evidence_id, b.evidence_id);
      if (!ev) throw badRequest('Unknown evidence ID.');
      if (!['png', 'jpeg', 'gif', 'webp'].includes(ev.detected_type)) throw badRequest('Screenshot requirements must be linked to an image (PNG, JPEG, GIF, or WebP).');
      if (s.capture_kind === 'tool_activity' && ev.source_category === 'project_artifact')
        throw badRequest('This requirement needs a screenshot of real tool activity from your lab, not a capture of this application.');
      db.update('screenshot_requirements', s.id, { evidence_id: ev.id, updated_at: nowIso() });
      logActivity(db, eng.id, 'tracker.screenshot_attached', 'screenshot', `Attached ${ev.code} to “${s.label}”`, { id: ev.id, code: ev.code });
    } else {
      db.update('screenshot_requirements', s.id, { evidence_id: null, updated_at: nowIso() });
      logActivity(db, eng.id, 'tracker.screenshot_detached', 'screenshot', `Detached screenshot from “${s.label}”`);
    }
    res.json({ ok: true });
  }));

  r.put('/tracker/deliverables/:did', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const d = db.get('SELECT * FROM deliverables WHERE id = ? AND engagement_id = ?', req.params.did, eng.id);
    if (!d) throw notFound('Deliverable');
    const b = z.object({ status: z.enum(['not_started', 'in_progress', 'done']).optional(), notes: z.string().max(4000).optional(), evidence_id: z.string().nullable().optional() }).strict().parse(req.body);
    let evId: string | null | undefined = undefined;
    if (b.evidence_id !== undefined) {
      if (b.evidence_id === null) evId = null;
      else {
        const ev = db.get('SELECT id FROM evidence WHERE engagement_id = ? AND (id = ? OR code = ?)', eng.id, b.evidence_id, b.evidence_id);
        if (!ev) throw badRequest('Unknown evidence ID.');
        evId = ev.id;
      }
    }
    db.update('deliverables', d.id, { status: b.status, notes: b.notes, evidence_id: evId, updated_by: currentActor(db), updated_at: nowIso() });
    logActivity(db, eng.id, 'tracker.deliverable', 'deliverable', `Deliverable “${d.label}” → ${b.status ?? d.status}`);
    res.json({ ok: true });
  }));

  r.post('/tracker/labs/:lab/signoff', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const lab = req.params.lab;
    const status = computeLabs(db, eng.id).find((l) => l.lab === lab);
    if (!status) throw notFound('Lab');
    const b = z.object({ signed: z.boolean(), notes: z.string().max(2000).default('') }).strict().parse(req.body);
    if (b.signed) {
      if (status.met < status.total) throw badRequest(`${status.title} still has ${status.total - status.met} unmet requirement(s). Sign-off is only available when every requirement is met.`);
      db.run(
        'INSERT INTO lab_signoffs (engagement_id, lab, signed_off_by, signed_off_at, notes) VALUES (?,?,?,?,?) ON CONFLICT(engagement_id, lab) DO UPDATE SET signed_off_by = excluded.signed_off_by, signed_off_at = excluded.signed_off_at, notes = excluded.notes',
        eng.id, lab, currentActor(db), nowIso(), b.notes,
      );
      logActivity(db, eng.id, 'tracker.lab_signed_off', 'lab', `${status.title} signed off`);
    } else {
      db.run('DELETE FROM lab_signoffs WHERE engagement_id = ? AND lab = ?', eng.id, lab);
      logActivity(db, eng.id, 'tracker.lab_signoff_removed', 'lab', `${status.title} sign-off removed`);
    }
    res.json({ ok: true });
  }));

  return r;
}
