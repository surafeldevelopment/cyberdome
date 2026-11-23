import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../app.js';
import { engagementFrom } from '../app.js';
import { badRequest, conflict, h, HttpError, notFound } from '../lib/http.js';
import { nextCode, nowIso, uid } from '../lib/codes.js';
import { parseJson, type Row } from '../db/index.js';
import { logActivity, currentActor } from '../lib/activity.js';
import { AI_TASKS, VERIFIED_REVIEW, type AiTask } from '../lib/constants.js';
import { aiStatus } from './system.js';
import { buildContext, refusalReason, ELIGIBLE_SANITIZATION, EXCERPT_PER_ITEM, EXCERPT_TOTAL } from '../services/ai/context.js';
import { callProvider, providerInfo, ProviderError } from '../services/ai/provider.js';
import { validateCitations, checkAttackIds, CITATION_NOTE } from '../services/ai/citations.js';

const TASK = z.enum(Object.keys(AI_TASKS) as [AiTask, ...AiTask[]]);
const ctxSchema = z
  .object({
    task: TASK,
    evidence_ids: z.array(z.string().min(1)).max(200).default([]),
    question: z.string().max(4000).optional(),
    include_file_excerpts: z.boolean().optional(),
  })
  .strict();

export const SETUP_INSTRUCTIONS = {
  summary: 'Connect an AI provider in Settings. The key is stored on this computer only and takes effect immediately, with no restart.',
  steps: [
    'Open Settings → AI provider.',
    'Pick Anthropic (Claude), OpenAI, or Ollama on this computer (free and offline), and paste an API key if the provider needs one.',
    'Click Save, then Test connection. The AI status pill turns green when a provider is configured.',
    'Advanced: the same values can be set in a .env file on the server instead.',
  ],
  env: ['AI_PROVIDER', 'CYBERDOME_ANTHROPIC_API_KEY', 'CYBERDOME_ANTHROPIC_MODEL', 'CYBERDOME_OPENAI_API_KEY', 'CYBERDOME_OPENAI_BASE_URL', 'CYBERDOME_OPENAI_MODEL'],
};

function reviewedText(db: Ctx['db'], s: Row): string | null {
  if (!VERIFIED_REVIEW.includes(s.review_status)) return null;
  const r = db.get(
    "SELECT * FROM human_reviews WHERE target_type = 'ai_session' AND target_id = ? AND decision IN ('verified','verified_with_edits') ORDER BY created_at DESC LIMIT 1",
    s.id,
  );
  if (!r) return null;
  return r.decision === 'verified_with_edits' && r.edited_text ? r.edited_text : s.response_text;
}

export function sessionSummary(s: Row) {
  return {
    id: s.id,
    code: s.code,
    task_type: s.task_type,
    task_label: AI_TASKS[s.task_type as AiTask]?.label ?? s.task_type,
    question: s.question,
    provider: s.provider,
    model: s.model,
    status: s.status,
    error: s.error,
    review_status: s.review_status,
    evidence_codes: parseJson<string[]>(s.evidence_codes, []),
    citations: parseJson<any>(s.citations, {}),
    created_by: s.created_by,
    created_at: s.created_at,
  };
}

export function sessionDetail(ctx: Ctx, eid: string, id: string) {
  const { db } = ctx;
  const s = db.get('SELECT * FROM ai_sessions WHERE engagement_id = ? AND (id = ? OR code = ?)', eid, id, id.toUpperCase());
  if (!s) throw notFound('AI session');
  const codes = parseJson<string[]>(s.evidence_codes, []);
  const evidence = codes.map(
    (c) => db.get('SELECT id, code, title, status, source_category, sanitization_status FROM evidence WHERE engagement_id = ? AND code = ?', eid, c) ?? { id: null, code: c, title: '(missing)', status: 'missing' },
  );
  const reviews = db.all("SELECT * FROM human_reviews WHERE target_type = 'ai_session' AND target_id = ? ORDER BY created_at DESC", s.id);
  const mappings = db.all('SELECT * FROM attack_mappings WHERE ai_session_id = ? ORDER BY created_at', s.id);
  const usedIn = db.get('SELECT narrative_sources FROM reports WHERE engagement_id = ?', eid);
  const sources = parseJson<Record<string, any>>(usedIn?.narrative_sources, {});
  return {
    ...sessionSummary(s),
    system_prompt: s.system_prompt,
    user_prompt: s.user_prompt,
    context_sha256: s.context_sha256,
    response_text: s.response_text,
    usage: parseJson<any>(s.usage, {}),
    attack_ids: parseJson<any[]>(s.attack_ids, []),
    evidence,
    reviews,
    reviewed_text: reviewedText(db, s),
    mappings,
    report_sections: Object.entries(sources).filter(([, v]) => v?.type === 'ai_session' && v.id === s.id).map(([k]) => k),
    citation_note: CITATION_NOTE,
  };
}

export default function aiRoutes(ctx: Ctx) {
  const r = Router({ mergeParams: true });
  const { db, cfg } = ctx;

  r.get('/ai/status', h((req, res) => {
    engagementFrom(ctx, req);
    res.json({
      ai: aiStatus(ctx),
      tasks: Object.entries(AI_TASKS).map(([key, v]) => ({ key, ...v })),
      policy: {
        eligible_sanitization: ELIGIBLE_SANITIZATION,
        excerpt_per_item_bytes: EXCERPT_PER_ITEM,
        excerpt_total_bytes: EXCERPT_TOTAL,
        note: 'Only active evidence reviewed as “sanitized” or “no sensitive data” is ever sent. Nothing is sent automatically; requests happen only when you click Generate.',
      },
      setup: SETUP_INSTRUCTIONS,
    });
  }));

  /** Evidence with eligibility flags, for the selection UI. */
  r.get('/ai/eligibility', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const rows = db.all(
      `SELECT e.id, e.code, e.title, e.status, e.kind, e.detected_type, e.source_category, e.source_tool, e.sanitization_status, e.tags,
        EXISTS (SELECT 1 FROM service_observations o WHERE o.evidence_id = e.id) OR EXISTS (SELECT 1 FROM scan_imports s WHERE s.evidence_id = e.id) AS is_scan,
        EXISTS (SELECT 1 FROM finding_evidence x WHERE x.evidence_id = e.id) OR EXISTS (SELECT 1 FROM finding_imports s WHERE s.evidence_id = e.id) AS is_finding,
        EXISTS (SELECT 1 FROM recon_evidence x WHERE x.evidence_id = e.id) AS is_recon,
        EXISTS (SELECT 1 FROM timeline_evidence x WHERE x.evidence_id = e.id) OR EXISTS (SELECT 1 FROM log_imports s WHERE s.evidence_id = e.id) AS is_timeline,
        EXISTS (SELECT 1 FROM indicator_evidence x WHERE x.evidence_id = e.id) AS is_indicator
       FROM evidence e WHERE e.engagement_id = ? ORDER BY CAST(substr(e.code, instr(e.code, 'EV-') + 3) AS INTEGER)`,
      eng.id,
    );
    res.json(
      rows.map((e) => {
        const reason = refusalReason(e);
        return {
          ...e,
          tags: parseJson<string[]>(e.tags, []),
          eligible: !reason,
          reason,
          modules: [e.is_scan && 'scan', e.is_finding && 'findings', e.is_recon && 'recon', e.is_timeline && 'timeline', e.is_indicator && 'indicators'].filter(Boolean),
        };
      }),
    );
  }));

  /** Records an analyst can attach a proposed ATT&CK mapping to. */
  r.get('/ai/mapping-targets', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    res.json({
      finding: db.all('SELECT id, code, title AS label FROM findings WHERE engagement_id = ? ORDER BY code', eng.id),
      timeline: db.all('SELECT id, code, substr(observation, 1, 120) AS label FROM timeline_events WHERE engagement_id = ? ORDER BY normalized_ts', eng.id),
      indicator: db.all('SELECT id, code, title AS label FROM indicators WHERE engagement_id = ? ORDER BY code', eng.id),
    });
  }));

  r.post('/ai/context-preview', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const b = ctxSchema.parse(req.body);
    const built = buildContext(ctx, eng.id, b);
    const info = providerInfo(cfg);
    res.json({ ...built, provider: info?.provider ?? null, model: info?.model ?? null, ai: aiStatus(ctx) });
  }));

  r.post('/ai/sessions', h(async (req, res) => {
    const eng = engagementFrom(ctx, req);
    const b = ctxSchema.parse(req.body);
    const info = providerInfo(cfg);
    if (!info) {
      const st = aiStatus(ctx);
      throw new HttpError(503, st.message ?? 'No AI provider is configured.', { ai: st, setup: SETUP_INSTRUCTIONS });
    }
    const built = buildContext(ctx, eng.id, b);
    const includedCodes = built.included.map((i) => i.code);
    let result: Awaited<ReturnType<typeof callProvider>> | null = null;
    let error: string | null = null;
    try {
      result = await callProvider(cfg, built.system, built.user);
    } catch (e) {
      error = e instanceof ProviderError ? e.message : 'The AI request failed unexpectedly.';
    }
    const citations = result ? validateCitations(db, eng.id, result.text, includedCodes) : {};
    const attackIds = result ? await checkAttackIds(db, result.text) : [];
    const id = uid();
    let code = '';
    db.tx(() => {
      code = nextCode(db, eng.id, 'ai_session');
      db.insert('ai_sessions', {
        id,
        engagement_id: eng.id,
        code,
        task_type: b.task,
        question: b.question?.trim() ?? '',
        provider: info.provider,
        model: result?.model || info.model || 'unknown',
        system_prompt: built.system,
        user_prompt: built.user,
        evidence_codes: includedCodes,
        context_sha256: built.sha256,
        status: result ? 'completed' : 'failed',
        error,
        response_text: result?.text ?? null,
        citations,
        attack_ids: attackIds,
        usage: result ? { ...result.usage, stop_reason: result.stopReason, refused_evidence: built.refused.map((x) => x.code) } : { refused_evidence: built.refused.map((x) => x.code) },
        review_status: 'unverified',
        created_by: currentActor(db),
        created_at: nowIso(),
      });
      logActivity(
        db, eng.id, result ? 'ai.generated' : 'ai.failed', 'ai_session',
        result ? `${code}: ${AI_TASKS[b.task].label}, unverified AI draft (${includedCodes.length} evidence records)` : `${code}: AI request failed — ${error}`,
        { id, code },
      );
    });
    const detail = sessionDetail(ctx, eng.id, id);
    if (!result) return res.status(502).json({ error, details: { session_id: id }, session: detail });
    res.status(201).json(detail);
  }));

  r.get('/ai/sessions', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const where = ['engagement_id = ?'];
    const p: any[] = [eng.id];
    if (typeof req.query.task === 'string' && req.query.task) { where.push('task_type = ?'); p.push(req.query.task); }
    if (typeof req.query.review_status === 'string' && req.query.review_status) {
      if (req.query.review_status === 'verified_any') where.push("review_status IN ('verified','verified_with_edits')");
      else { where.push('review_status = ?'); p.push(req.query.review_status); }
    }
    if (typeof req.query.status === 'string' && req.query.status) { where.push('status = ?'); p.push(req.query.status); }
    const rows = db.all(`SELECT * FROM ai_sessions WHERE ${where.join(' AND ')} ORDER BY created_at DESC`, ...p);
    res.json(rows.map((s) => ({ ...sessionSummary(s), reviewed_text: reviewedText(db, s), excerpt: (s.response_text ?? '').slice(0, 240) })));
  }));

  r.get('/ai/sessions/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    res.json(sessionDetail(ctx, eng.id, req.params.id));
  }));

  r.post('/ai/sessions/:id/review', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const s = db.get('SELECT * FROM ai_sessions WHERE engagement_id = ? AND id = ?', eng.id, req.params.id);
    if (!s) throw notFound('AI session');
    if (s.status !== 'completed') throw badRequest('Only completed AI responses can be reviewed.');
    const b = z
      .object({
        decision: z.enum(['verified', 'verified_with_edits', 'rejected']),
        notes: z.string().trim().min(3, 'A verification note is required.').max(8000),
        edited_text: z.string().max(60000).optional(),
        reviewer: z.string().trim().max(120).optional(),
      })
      .strict()
      .parse(req.body);
    if (b.decision === 'verified_with_edits' && !b.edited_text?.trim()) throw badRequest('Provide the edited text when verifying with edits.');
    const reviewer = b.reviewer || currentActor(db);
    db.tx(() => {
      db.insert('human_reviews', {
        id: uid(),
        engagement_id: eng.id,
        target_type: 'ai_session',
        target_id: s.id,
        reviewer,
        decision: b.decision,
        notes: b.notes,
        edited_text: b.decision === 'verified_with_edits' ? b.edited_text : null,
        created_at: nowIso(),
      });
      db.run('UPDATE ai_sessions SET review_status = ? WHERE id = ?', b.decision, s.id);
      logActivity(db, eng.id, 'ai.reviewed', 'ai_session', `${s.code} reviewed by ${reviewer}: ${b.decision.replace(/_/g, ' ')}`, { id: s.id, code: s.code }, reviewer);
    });
    res.json(sessionDetail(ctx, eng.id, s.id));
  }));

  r.post('/ai/sessions/:id/proposed-mapping', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const s = db.get('SELECT * FROM ai_sessions WHERE engagement_id = ? AND id = ?', eng.id, req.params.id);
    if (!s) throw notFound('AI session');
    const b = z
      .object({
        technique_id: z.string().trim().regex(/^T\d{4}(\.\d{3})?$/, 'Use an ATT&CK technique ID such as T1110 or T1110.001'),
        target_type: z.enum(['finding', 'timeline', 'indicator']),
        target_id: z.string().min(1),
        rationale: z.string().trim().max(4000).default(''),
      })
      .strict()
      .parse(req.body);
    const suggested = parseJson<any[]>(s.attack_ids, []);
    const sug = suggested.find((x) => x.id === b.technique_id.toUpperCase());
    if (!sug) throw badRequest('That technique ID was not suggested in this AI response.');
    const table = { finding: 'findings', timeline: 'timeline_events', indicator: 'indicators' }[b.target_type];
    const target = db.get(`SELECT id, code FROM ${table} WHERE engagement_id = ? AND (id = ? OR code = ?)`, eng.id, b.target_id, b.target_id.toUpperCase());
    if (!target) throw badRequest(`Unknown ${b.target_type} for this engagement.`);
    const dup = db.get('SELECT id FROM attack_mappings WHERE engagement_id = ? AND target_type = ? AND target_id = ? AND technique_id = ?', eng.id, b.target_type, target.id, sug.id);
    if (dup) throw conflict('This technique is already mapped to that record.');
    const id = uid();
    db.insert('attack_mappings', {
      id,
      engagement_id: eng.id,
      target_type: b.target_type,
      target_id: target.id,
      technique_id: sug.id,
      technique_name: sug.name ?? '',
      tactics: sug.tactics ?? '',
      rationale: b.rationale || `Suggested by ${s.code}; requires human verification.`,
      origin: 'ai_suggested',
      status: 'proposed',
      ai_session_id: s.id,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    logActivity(db, eng.id, 'attack_mapping.proposed', 'attack_mapping', `Proposed ${sug.id} for ${target.code} from ${s.code} (needs verification)`, { id, code: target.code });
    res.status(201).json(sessionDetail(ctx, eng.id, s.id));
  }));

  return r;
}
