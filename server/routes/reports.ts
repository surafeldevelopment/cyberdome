import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../app.js';
import { engagementFrom } from '../app.js';
import { badRequest, h, notFound } from '../lib/http.js';
import { nowIso } from '../lib/codes.js';
import { parseJson } from '../db/index.js';
import { logActivity, currentActor } from '../lib/activity.js';
import { VERIFIED_REVIEW } from '../lib/constants.js';
import { reportReadiness, NARRATIVE_KEYS } from '../services/readiness.js';
import { assembleReport, ensureReport, SECTION_TITLES } from '../services/report/assemble.js';
import { renderExecutiveHtml, renderReportHtml, renderReportMarkdown, renderReportBody, renderExecutiveBody } from '../services/report/render.js';
import { engagementDump, writePackage } from '../services/report/package.js';
import { readEvidenceBytes } from '../services/evidence.js';
import { IMAGE_TYPES } from '../lib/filetype.js';

const KEY = z.enum(NARRATIVE_KEYS as unknown as [string, ...string[]]);

export default function reportRoutes(ctx: Ctx) {
  const r = Router({ mergeParams: true });
  const { db, cfg } = ctx;
  const stamp = () => new Date().toISOString().slice(0, 10);
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'engagement';

  r.get('/report', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const data = assembleReport(ctx, eng.id);
    res.json(data);
  }));

  /** Escaped HTML fragment for the in-app preview and print views (images served from the evidence endpoint). */
  r.get('/report/render', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const data = assembleReport(ctx, eng.id);
    const kind = req.query.kind === 'executive' ? 'executive' : 'full';
    const html =
      kind === 'executive'
        ? renderExecutiveBody(data)
        : renderReportBody(data, {
            imageSrc: (id) => {
              const ev = db.get('SELECT detected_type FROM evidence WHERE id = ?', id);
              return ev && IMAGE_TYPES.includes(ev.detected_type) ? `/api/engagements/${eng.id}/evidence/${id}/raw?inline=1` : null;
            },
          });
    res.json({ kind, html, title: data.report.title, status: data.report.status, is_demo: data.engagement.is_demo, generated_at: data.generated_at, readiness: data.readiness });
  }));

  r.get('/report/readiness', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    res.json(reportReadiness(db, eng.id));
  }));

  r.put('/report', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const rep = ensureReport(ctx, eng.id);
    if (rep.status === 'final') throw badRequest('The report is finalized. Reopen it before editing.');
    const b = z
      .object({
        title: z.string().trim().min(1).max(300).optional(),
        narrative: z.record(KEY, z.string().max(60000)).optional(),
      })
      .strict()
      .parse(req.body);
    const narrative = parseJson<Record<string, string>>(rep.narrative, {});
    const sources = parseJson<Record<string, any>>(rep.narrative_sources, {});
    const changed: string[] = [];
    for (const [k, v] of Object.entries(b.narrative ?? {})) {
      if ((narrative[k] ?? '') === v) continue;
      narrative[k] = v;
      changed.push(k);
      // Any manual edit replaces AI provenance: the section is now analyst-entered.
      sources[k] = v.trim() ? { type: 'manual', by: currentActor(db), at: nowIso(), edited_from: sources[k]?.type === 'ai_session' ? sources[k].code : undefined } : undefined;
      if (!v.trim()) delete sources[k];
    }
    db.update('reports', rep.id, { title: b.title, narrative, narrative_sources: sources, updated_at: nowIso() });
    if (changed.length || b.title) logActivity(db, eng.id, 'report.updated', 'report', `Report edited: ${[...(b.title ? ['title'] : []), ...changed.map((k) => SECTION_TITLES[k] ?? k)].join(', ')}`, { id: rep.id });
    res.json(assembleReport(ctx, eng.id));
  }));

  r.post('/report/sections/:key/from-ai', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const key = KEY.parse(req.params.key);
    const rep = ensureReport(ctx, eng.id);
    if (rep.status === 'final') throw badRequest('The report is finalized. Reopen it before editing.');
    const b = z.object({ session_id: z.string().min(1) }).strict().parse(req.body);
    const s = db.get('SELECT * FROM ai_sessions WHERE engagement_id = ? AND (id = ? OR code = ?)', eng.id, b.session_id, b.session_id.toUpperCase());
    if (!s) throw notFound('AI session');
    if (!VERIFIED_REVIEW.includes(s.review_status))
      throw badRequest(`${s.code} is ${s.review_status.replace(/_/g, ' ')}. Only AI text that a team member has verified can be placed in the report.`);
    const review = db.get(
      "SELECT * FROM human_reviews WHERE target_type = 'ai_session' AND target_id = ? AND decision IN ('verified','verified_with_edits') ORDER BY created_at DESC LIMIT 1",
      s.id,
    );
    if (!review) throw badRequest('No verification record exists for this AI session.');
    const text = review.decision === 'verified_with_edits' && review.edited_text ? review.edited_text : s.response_text;
    const narrative = parseJson<Record<string, string>>(rep.narrative, {});
    const sources = parseJson<Record<string, any>>(rep.narrative_sources, {});
    narrative[key] = text;
    sources[key] = { type: 'ai_session', id: s.id, code: s.code, reviewer: review.reviewer, reviewed_at: review.created_at, decision: review.decision, inserted_by: currentActor(db), inserted_at: nowIso() };
    db.update('reports', rep.id, { narrative, narrative_sources: sources, updated_at: nowIso() });
    logActivity(db, eng.id, 'report.section_from_ai', 'report', `Inserted verified AI text ${s.code} into “${SECTION_TITLES[key]}”`, { id: rep.id, code: s.code });
    res.json(assembleReport(ctx, eng.id));
  }));

  r.post('/report/finalize', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const rep = ensureReport(ctx, eng.id);
    const rd = reportReadiness(db, eng.id);
    if (!rd.ready) throw badRequest(`The report has ${rd.blockers} blocking issue(s). Resolve them before finalizing.`, { issues: rd.issues });
    db.update('reports', rep.id, { status: 'final', finalized_by: currentActor(db), finalized_at: nowIso(), updated_at: nowIso() });
    logActivity(db, eng.id, 'report.finalized', 'report', 'Report finalized', { id: rep.id });
    res.json(assembleReport(ctx, eng.id));
  }));

  r.post('/report/reopen', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const rep = ensureReport(ctx, eng.id);
    db.update('reports', rep.id, { status: 'draft', finalized_by: null, finalized_at: null, updated_at: nowIso() });
    logActivity(db, eng.id, 'report.reopened', 'report', 'Report reopened for editing', { id: rep.id });
    res.json(assembleReport(ctx, eng.id));
  }));

  // ---------- Exports ----------
  const attach = (res: any, name: string, type: string) => {
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  };

  r.get('/exports/engagement.json', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    attach(res, `${slug(eng.name)}-data-${stamp()}.json`, 'application/json; charset=utf-8');
    logActivity(db, eng.id, 'export.engagement_json', 'export', 'Exported complete engagement data (JSON)');
    res.send(JSON.stringify(engagementDump(ctx, eng.id), null, 2));
  }));

  r.get('/exports/report.html', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const data = assembleReport(ctx, eng.id);
    // Standalone file: embed screenshot images (raster only, max 3 MB each) as data URIs.
    const html = renderReportHtml(data, {
      imageSrc: (id) => {
        const ev = db.get('SELECT * FROM evidence WHERE id = ?', id);
        if (!ev || !IMAGE_TYPES.includes(ev.detected_type)) return null;
        const b = readEvidenceBytes(cfg, ev);
        if (!b || b.length > 3 * 1024 * 1024) return null;
        return `data:${ev.mime_type};base64,${b.toString('base64')}`;
      },
    });
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:");
    attach(res, `${slug(eng.name)}-report-${stamp()}.html`, 'text/html; charset=utf-8');
    logActivity(db, eng.id, 'export.report_html', 'export', 'Exported technical report (HTML)');
    res.send(html);
  }));

  r.get('/exports/report.md', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    attach(res, `${slug(eng.name)}-report-${stamp()}.md`, 'text/markdown; charset=utf-8');
    logActivity(db, eng.id, 'export.report_md', 'export', 'Exported technical report (Markdown)');
    res.send(renderReportMarkdown(assembleReport(ctx, eng.id)));
  }));

  r.get('/exports/executive-summary.html', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; font-src data:");
    attach(res, `${slug(eng.name)}-executive-summary-${stamp()}.html`, 'text/html; charset=utf-8');
    logActivity(db, eng.id, 'export.executive_summary', 'export', 'Exported one-page executive summary (HTML)');
    res.send(renderExecutiveHtml(assembleReport(ctx, eng.id)));
  }));

  r.get('/exports/package.zip', h(async (req, res) => {
    const eng = engagementFrom(ctx, req);
    const sanitizedOnly = req.query.sanitized_only === '1';
    attach(res, `${slug(eng.name)}-evidence-package-${stamp()}.zip`, 'application/zip');
    const manifest = await writePackage(ctx, eng.id, res, { sanitizedOnly });
    logActivity(db, eng.id, 'export.package', 'export', `Exported evidence package (${manifest.files.length} files, ${manifest.excluded_evidence.length} evidence items excluded${sanitizedOnly ? ', sanitized-only' : ''})`);
  }));

  return r;
}
