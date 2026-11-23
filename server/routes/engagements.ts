import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../app.js';
import { badRequest, h, notFound } from '../lib/http.js';
import { nowIso, uid } from '../lib/codes.js';
import { logActivity, currentActor } from '../lib/activity.js';
import { createEngagement } from '../services/bootstrap.js';
import { inferTargetType, checkScope } from '../lib/scope.js';
import { isValidTimezone } from '../lib/time.js';

const opt = (max = 10000) => z.string().max(max).optional();

const engagementPatch = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    client_name: opt(200),
    purpose: opt(),
    authorization_ref: opt(500),
    window_start: z.string().max(40).nullable().optional(),
    window_end: z.string().max(40).nullable().optional(),
    timezone: z.string().max(64).refine(isValidTimezone, 'Unknown IANA timezone').optional(),
    rules_of_engagement: opt(),
    prohibited_actions: opt(),
    approved_evidence_sources: opt(),
    status: z.enum(['planning', 'active', 'reporting', 'complete', 'on_hold']).optional(),
  })
  .strict();

const scopeSchema = z
  .object({
    kind: z.enum(['in', 'out']),
    target: z.string().trim().min(1).max(500),
    target_type: z.enum(['cidr', 'ip', 'range', 'domain', 'url', 'hostname', 'other']).optional(),
    notes: z.string().max(2000).optional(),
    confirmed: z.boolean().optional(),
  })
  .strict();

const teamSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    role: z.string().max(120).optional(),
    responsibilities: z.string().max(4000).optional(),
    contributions: z.string().max(8000).optional(),
  })
  .strict();

export function engagementDetail(ctx: Ctx, id: string) {
  const { db } = ctx;
  const eng = db.get('SELECT * FROM engagements WHERE id = ?', id);
  if (!eng) throw notFound('Engagement');
  return {
    ...eng,
    is_demo: !!eng.is_demo,
    scope: db.all('SELECT * FROM scope_entries WHERE engagement_id = ? ORDER BY kind, created_at', id).map((s) => ({ ...s, confirmed: !!s.confirmed })),
    team: db.all('SELECT * FROM team_members WHERE engagement_id = ? ORDER BY created_at', id),
  };
}

export default function engagementRoutes(ctx: Ctx) {
  const r = Router();
  const { db } = ctx;

  r.get(
    '/engagements',
    h((_req, res) => {
      res.json(
        db
          .all('SELECT id, name, client_name, status, is_demo, authorization_status, created_at, updated_at FROM engagements ORDER BY is_demo, created_at')
          .map((e) => ({ ...e, is_demo: !!e.is_demo })),
      );
    }),
  );

  r.post(
    '/engagements',
    h((req, res) => {
      const body = z.object({ name: z.string().trim().min(1).max(200), client_name: z.string().max(200).optional() }).strict().parse(req.body);
      const id = createEngagement(db, { name: body.name, client_name: body.client_name || 'CyberDome Corporation' });
      logActivity(db, id, 'engagement.created', 'engagement', `Created engagement “${body.name}”`, { id });
      res.status(201).json(engagementDetail(ctx, id));
    }),
  );

  r.get('/engagements/:eid', h((req, res) => res.json(engagementDetail(ctx, req.params.eid))));

  r.patch(
    '/engagements/:eid',
    h((req, res) => {
      const eng = db.get('SELECT * FROM engagements WHERE id = ?', req.params.eid);
      if (!eng) throw notFound('Engagement');
      const body = engagementPatch.parse(req.body);
      if (body.window_start && body.window_end && body.window_start > body.window_end) throw badRequest('Testing window end must be after its start.');
      const patch: Record<string, any> = { ...body, updated_at: nowIso() };
      // Changing the authorization reference invalidates a previous confirmation.
      if (body.authorization_ref !== undefined && body.authorization_ref !== eng.authorization_ref && eng.authorization_status === 'confirmed') {
        patch.authorization_status = 'unconfirmed';
        patch.authorization_confirmed_by = null;
        patch.authorization_confirmed_at = null;
      }
      db.update('engagements', eng.id, patch);
      logActivity(db, eng.id, 'engagement.updated', 'engagement', `Updated engagement fields: ${Object.keys(body).join(', ')}`, { id: eng.id });
      res.json(engagementDetail(ctx, eng.id));
    }),
  );

  r.post(
    '/engagements/:eid/authorization',
    h((req, res) => {
      const eng = db.get('SELECT * FROM engagements WHERE id = ?', req.params.eid);
      if (!eng) throw notFound('Engagement');
      const body = z.object({ confirmed: z.boolean(), confirmed_by: z.string().trim().max(120).optional() }).strict().parse(req.body);
      if (body.confirmed) {
        if (!eng.authorization_ref.trim()) throw badRequest('Record the written authorization reference before confirming authorization.');
        const by = body.confirmed_by || currentActor(db);
        db.update('engagements', eng.id, { authorization_status: 'confirmed', authorization_confirmed_by: by, authorization_confirmed_at: nowIso(), updated_at: nowIso() });
        logActivity(db, eng.id, 'authorization.confirmed', 'engagement', `Authorization confirmed by ${by} (ref: ${eng.authorization_ref})`, { id: eng.id });
      } else {
        db.update('engagements', eng.id, { authorization_status: 'unconfirmed', authorization_confirmed_by: null, authorization_confirmed_at: null, updated_at: nowIso() });
        logActivity(db, eng.id, 'authorization.revoked', 'engagement', 'Authorization marked unconfirmed', { id: eng.id });
      }
      res.json(engagementDetail(ctx, eng.id));
    }),
  );

  r.delete(
    '/engagements/:eid',
    h((req, res) => {
      const eng = db.get('SELECT * FROM engagements WHERE id = ?', req.params.eid);
      if (!eng) throw notFound('Engagement');
      const confirm = String(req.body?.confirm ?? '');
      if (confirm !== eng.name) throw badRequest('Type the engagement name exactly to confirm deletion.');
      const realCount = db.scalar<number>('SELECT COUNT(*) FROM engagements WHERE is_demo = 0');
      if (!eng.is_demo && realCount <= 1) throw badRequest('The last real engagement cannot be deleted. Create another engagement first.');
      db.run('DELETE FROM engagements WHERE id = ?', eng.id);
      logActivity(db, null, 'engagement.deleted', 'engagement', `Deleted engagement “${eng.name}” and its records (evidence files remain on disk until backup cleanup)`);
      res.json({ ok: true });
    }),
  );

  // ---- Scope ----
  r.post(
    '/engagements/:eid/scope',
    h((req, res) => {
      const eng = db.get('SELECT id FROM engagements WHERE id = ?', req.params.eid);
      if (!eng) throw notFound('Engagement');
      const b = scopeSchema.parse(req.body);
      const id = uid();
      const now = nowIso();
      db.insert('scope_entries', {
        id, engagement_id: eng.id, kind: b.kind, target: b.target, target_type: b.target_type ?? inferTargetType(b.target),
        notes: b.notes ?? '', confirmed: b.confirmed ? 1 : 0, confirmed_by: b.confirmed ? currentActor(db) : null, created_at: now, updated_at: now,
      });
      logActivity(db, eng.id, 'scope.added', 'scope', `${b.kind === 'in' ? 'Authorized' : 'Excluded'} target added: ${b.target}${b.confirmed ? ' (confirmed)' : ' (unconfirmed)'}`, { id });
      res.status(201).json(engagementDetail(ctx, eng.id));
    }),
  );

  r.patch(
    '/engagements/:eid/scope/:sid',
    h((req, res) => {
      const row = db.get('SELECT * FROM scope_entries WHERE id = ? AND engagement_id = ?', req.params.sid, req.params.eid);
      if (!row) throw notFound('Scope entry');
      const b = scopeSchema.partial().strict().parse(req.body);
      db.update('scope_entries', row.id, {
        ...b,
        target_type: b.target ? (b.target_type ?? inferTargetType(b.target)) : b.target_type,
        confirmed: b.confirmed === undefined ? undefined : b.confirmed ? 1 : 0,
        confirmed_by: b.confirmed === undefined ? undefined : b.confirmed ? currentActor(db) : null,
        updated_at: nowIso(),
      });
      logActivity(db, req.params.eid, 'scope.updated', 'scope', `Updated scope entry ${b.target ?? row.target}`, { id: row.id });
      res.json(engagementDetail(ctx, req.params.eid));
    }),
  );

  r.delete(
    '/engagements/:eid/scope/:sid',
    h((req, res) => {
      const row = db.get('SELECT * FROM scope_entries WHERE id = ? AND engagement_id = ?', req.params.sid, req.params.eid);
      if (!row) throw notFound('Scope entry');
      db.run('DELETE FROM scope_entries WHERE id = ?', row.id);
      logActivity(db, req.params.eid, 'scope.removed', 'scope', `Removed scope entry ${row.target}`, { id: row.id });
      res.json(engagementDetail(ctx, req.params.eid));
    }),
  );

  r.get(
    '/engagements/:eid/scope/check',
    h((req, res) => {
      const ip = typeof req.query.ip === 'string' ? req.query.ip : null;
      const host = typeof req.query.host === 'string' ? req.query.host : null;
      res.json(checkScope(db, req.params.eid, ip, host));
    }),
  );

  // ---- Team ----
  r.post(
    '/engagements/:eid/team',
    h((req, res) => {
      const eng = db.get('SELECT id FROM engagements WHERE id = ?', req.params.eid);
      if (!eng) throw notFound('Engagement');
      const b = teamSchema.parse(req.body);
      const id = uid();
      const now = nowIso();
      db.insert('team_members', { id, engagement_id: eng.id, name: b.name, role: b.role ?? '', responsibilities: b.responsibilities ?? '', contributions: b.contributions ?? '', created_at: now, updated_at: now });
      logActivity(db, eng.id, 'team.added', 'team_member', `Added team member ${b.name}${b.role ? ` (${b.role})` : ''}`, { id });
      res.status(201).json(engagementDetail(ctx, eng.id));
    }),
  );

  r.patch(
    '/engagements/:eid/team/:tid',
    h((req, res) => {
      const row = db.get('SELECT * FROM team_members WHERE id = ? AND engagement_id = ?', req.params.tid, req.params.eid);
      if (!row) throw notFound('Team member');
      const b = teamSchema.partial().strict().parse(req.body);
      db.update('team_members', row.id, { ...b, updated_at: nowIso() });
      logActivity(db, req.params.eid, 'team.updated', 'team_member', `Updated team member ${b.name ?? row.name}`, { id: row.id });
      res.json(engagementDetail(ctx, req.params.eid));
    }),
  );

  r.delete(
    '/engagements/:eid/team/:tid',
    h((req, res) => {
      const row = db.get('SELECT * FROM team_members WHERE id = ? AND engagement_id = ?', req.params.tid, req.params.eid);
      if (!row) throw notFound('Team member');
      db.run('DELETE FROM team_members WHERE id = ?', row.id);
      logActivity(db, req.params.eid, 'team.removed', 'team_member', `Removed team member ${row.name}`, { id: row.id });
      res.json(engagementDetail(ctx, req.params.eid));
    }),
  );

  return r;
}
