import crypto from 'node:crypto';
import * as archiverNs from 'archiver';
const archiver: any = (archiverNs as any).default ?? archiverNs;
import type { Writable } from 'node:stream';
import type { Ctx } from '../../app.js';
import { parseJson } from '../../db/index.js';
import { toCsv } from '../../lib/csv.js';
import { listEvidence } from '../../routes/evidence.js';
import { readEvidenceBytes } from '../evidence.js';
import { assembleReport } from './assemble.js';
import { renderExecutiveHtml, renderReportHtml, renderReportMarkdown } from './render.js';

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const safe = (s: string) => s.replace(/[^\w.\-()]+/g, '_').slice(0, 120);

/** Complete engagement data dump. Every record type, with source categories where applicable. */
export function engagementDump(ctx: Ctx, eid: string) {
  const { db } = ctx;
  const all = (sql: string) => db.all(sql, eid);
  const eng = db.get('SELECT * FROM engagements WHERE id = ?', eid)!;
  const link = (table: string, col: string, other: string) => db.all(`SELECT l.${col} AS owner, l.${other} AS other FROM ${table} l`).filter(Boolean);
  const evidenceCode = new Map(db.all('SELECT id, code FROM evidence WHERE engagement_id = ?', eid).map((r) => [r.id, r.code]));
  const linksFor = (table: string, col: string) => {
    const m = new Map<string, string[]>();
    for (const r of link(table, col, 'evidence_id')) if (evidenceCode.has(r.other)) m.set(r.owner, [...(m.get(r.owner) ?? []), evidenceCode.get(r.other)!]);
    return m;
  };
  const fe = linksFor('finding_evidence', 'finding_id');
  const re = linksFor('recon_evidence', 'recon_id');
  const ie = linksFor('indicator_evidence', 'indicator_id');
  const te = linksFor('timeline_evidence', 'timeline_id');
  const assetCode = new Map(db.all('SELECT id, code FROM assets WHERE engagement_id = ?', eid).map((r) => [r.id, r.code]));
  return {
    format: 'cyberdome-engagement-export',
    version: 1,
    exported_at: new Date().toISOString(),
    data_labels: {
      is_demo: !!eng.is_demo,
      note: eng.is_demo
        ? 'DEMO DATA: every record in this export is synthetic demonstration data.'
        : 'Records are labeled with their source category (authorized_lab, instructor_supplied, external_reference, project_artifact). Calculated values are recomputed by the application and are not stored here.',
    },
    engagement: { ...eng, is_demo: !!eng.is_demo },
    scope: all('SELECT * FROM scope_entries WHERE engagement_id = ?'),
    team: all('SELECT * FROM team_members WHERE engagement_id = ?'),
    evidence: all('SELECT * FROM evidence WHERE engagement_id = ? ORDER BY code').map((e) => ({ ...e, tags: parseJson(e.tags, []), storage_path: undefined })),
    evidence_reviews: db.all('SELECT r.* FROM evidence_reviews r JOIN evidence e ON e.id = r.evidence_id WHERE e.engagement_id = ?', eid),
    assets: all('SELECT * FROM assets WHERE engagement_id = ? ORDER BY code').map((a) => ({ ...a, hostnames: parseJson(a.hostnames, []) })),
    services: all('SELECT * FROM services WHERE engagement_id = ?').map((s) => ({ ...s, asset_code: assetCode.get(s.asset_id) })),
    scan_imports: all('SELECT * FROM scan_imports WHERE engagement_id = ? ORDER BY code'),
    service_observations: all('SELECT * FROM service_observations WHERE engagement_id = ?'),
    finding_imports: all('SELECT * FROM finding_imports WHERE engagement_id = ?'),
    findings: all('SELECT * FROM findings WHERE engagement_id = ? ORDER BY code').map((f) => ({
      ...f,
      cves: parseJson(f.cves, []),
      evidence_codes: fe.get(f.id) ?? [],
      asset_codes: db.all('SELECT asset_id FROM finding_assets WHERE finding_id = ?', f.id).map((x) => assetCode.get(x.asset_id)),
      service_ids: db.all('SELECT service_id FROM finding_services WHERE finding_id = ?', f.id).map((x) => x.service_id),
    })),
    remediation_tasks: all('SELECT * FROM remediation_tasks WHERE engagement_id = ?'),
    recon_observations: all('SELECT * FROM recon_observations WHERE engagement_id = ? ORDER BY code').map((r) => ({ ...r, evidence_codes: re.get(r.id) ?? [] })),
    indicators: all('SELECT * FROM indicators WHERE engagement_id = ? ORDER BY code').map((r) => ({ ...r, evidence_codes: ie.get(r.id) ?? [] })),
    log_imports: all('SELECT * FROM log_imports WHERE engagement_id = ?'),
    log_events: all('SELECT * FROM log_events WHERE engagement_id = ? ORDER BY normalized_ts'),
    timeline_events: all('SELECT * FROM timeline_events WHERE engagement_id = ? ORDER BY normalized_ts').map((r) => ({ ...r, evidence_codes: te.get(r.id) ?? [] })),
    attack_mappings: all('SELECT * FROM attack_mappings WHERE engagement_id = ?'),
    ai_sessions: all('SELECT * FROM ai_sessions WHERE engagement_id = ? ORDER BY code').map((s) => ({
      ...s, evidence_codes: parseJson(s.evidence_codes, []), citations: parseJson(s.citations, {}), attack_ids: parseJson(s.attack_ids, []), usage: parseJson(s.usage, {}),
      label: s.review_status === 'unverified' ? 'UNVERIFIED AI DRAFT' : s.review_status === 'rejected' ? 'REJECTED AI DRAFT' : 'AI DRAFT VERIFIED BY HUMAN',
    })),
    human_reviews: all('SELECT * FROM human_reviews WHERE engagement_id = ?'),
    report: db.get('SELECT * FROM reports WHERE engagement_id = ?', eid),
    deliverables: all('SELECT * FROM deliverables WHERE engagement_id = ?'),
    screenshot_requirements: all('SELECT * FROM screenshot_requirements WHERE engagement_id = ?'),
    lab_signoffs: all('SELECT * FROM lab_signoffs WHERE engagement_id = ?'),
    activity: all('SELECT * FROM activity WHERE engagement_id = ? ORDER BY id'),
  };
}

export function evidenceIndexRows(ctx: Ctx, eid: string) {
  const { db } = ctx;
  const { items } = listEvidence(ctx, eid, { status: 'all', sort: 'code', dir: 'asc' }, false);
  return items.map((e: any) => ({
    evidence_id: e.code, title: e.title, status: e.status, kind: e.kind, original_filename: e.original_filename ?? '', file_type: e.detected_type ?? '',
    size_bytes: e.size_bytes ?? '', sha256: e.sha256 ?? '', hash_origin: e.kind === 'file' ? 'calculated_from_bytes' : e.sha256 ? 'analyst_supplied' : '',
    reference_uri: e.reference_uri ?? '', source_category: e.source_category, source_tool: e.source_tool, collected_at: e.collected_at ?? '', collected_at_note: e.collected_at_note ?? '',
    imported_at: e.imported_at, assets: e.asset_labels ?? '', observation: e.observation, interpretation: e.interpretation, confidence: e.confidence,
    tags: (e.tags ?? []).join('; '), sanitization_status: e.sanitization_status, derived_from: e.derived_from_id ? db.scalar('SELECT code FROM evidence WHERE id = ?', e.derived_from_id) : '',
    linked_findings: e.finding_links, linked_timeline_events: e.timeline_links, linked_recon: e.recon_links, linked_indicators: e.indicator_links, analysis_status: e.analysis_status,
  }));
}

export interface PackageOptions {
  sanitizedOnly: boolean;
}

/** Build the evidence/project package zip and stream it. Manifest lists sha256 + size of every other file. */
export async function writePackage(ctx: Ctx, eid: string, out: Writable, opts: PackageOptions) {
  const { db, cfg } = ctx;
  const files: { path: string; data: Buffer; description: string }[] = [];
  const excluded: { evidence_id: string; title: string; reason: string }[] = [];
  const add = (path: string, data: Buffer | string, description: string) => files.push({ path, data: Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'), description });

  const evRows = db.all("SELECT * FROM evidence WHERE engagement_id = ? ORDER BY CAST(substr(code, instr(code, 'EV-') + 3) AS INTEGER)", eid);
  const pathById = new Map<string, string>();
  for (const ev of evRows) {
    if (ev.kind !== 'file') { excluded.push({ evidence_id: ev.code, title: ev.title, reason: 'Recorded by reference; the artifact is not stored in the application.' }); continue; }
    if (ev.status !== 'active') { excluded.push({ evidence_id: ev.code, title: ev.title, reason: `Withdrawn: ${ev.withdrawn_reason ?? ''}` }); continue; }
    if (ev.sanitization_status === 'contains_sensitive') { excluded.push({ evidence_id: ev.code, title: ev.title, reason: 'Marked as containing sensitive data.' }); continue; }
    if (opts.sanitizedOnly && !['sanitized', 'no_sensitive_data'].includes(ev.sanitization_status)) { excluded.push({ evidence_id: ev.code, title: ev.title, reason: 'Sanitization not reviewed (sanitized-only package).' }); continue; }
    const bytes = readEvidenceBytes(cfg, ev);
    if (!bytes) { excluded.push({ evidence_id: ev.code, title: ev.title, reason: 'Stored file is missing.' }); continue; }
    const hashOk = sha(bytes) === ev.sha256;
    const p = `evidence/${ev.code}__${safe(ev.original_filename ?? 'file')}`;
    pathById.set(ev.id, p);
    add(p, bytes, `${ev.code} — ${ev.title} (${ev.source_category}; sanitization: ${ev.sanitization_status}${ev.derived_from_id ? `; derived from ${db.scalar('SELECT code FROM evidence WHERE id = ?', ev.derived_from_id)}` : ''})${hashOk ? '' : ' WARNING: stored hash does not match file bytes'}`);
  }

  const data = assembleReport(ctx, eid);
  const rows = evidenceIndexRows(ctx, eid);
  add('evidence-index.csv', toCsv(rows), 'Evidence index (all evidence records, including withdrawn and references)');
  add('evidence-index.json', JSON.stringify({ count: rows.length, evidence: rows }, null, 2), 'Evidence index (JSON)');
  add('report.html', renderReportHtml(data, { imageSrc: (id) => (pathById.has(id) ? `./${pathById.get(id)}` : null) }), 'Technical report (HTML; open in a browser and print to PDF)');
  add('report.md', renderReportMarkdown(data), 'Technical report (Markdown)');
  add('executive-summary.html', renderExecutiveHtml(data), 'One-page executive summary (HTML)');
  const dump = engagementDump(ctx, eid);
  add('data/engagement.json', JSON.stringify(dump, null, 2), 'Complete engagement data export');
  const csvs: [string, any[]][] = [
    ['assets', dump.assets],
    ['services', dump.services],
    ['service_observations', dump.service_observations],
    ['findings', dump.findings],
    ['recon_observations', dump.recon_observations],
    ['indicators', dump.indicators],
    ['timeline_events', dump.timeline_events],
    ['ai_sessions', dump.ai_sessions.map((s: any) => ({ code: s.code, label: s.label, task_type: s.task_type, provider: s.provider, model: s.model, status: s.status, review_status: s.review_status, evidence_codes: s.evidence_codes.join(' '), created_at: s.created_at }))],
  ];
  for (const [name, list] of csvs) add(`data/${name}.csv`, toCsv(list), `${name.replace(/_/g, ' ')} (CSV)`);

  const eng = data.engagement;
  add(
    'README.txt',
    [
      `CyberDome Command Center — evidence package`,
      `Engagement: ${eng.name} (${eng.client_name})${eng.is_demo ? '  *** DEMO DATA — synthetic records, not assessment results ***' : ''}`,
      `Exported: ${new Date().toISOString()}`,
      `Report status: ${data.report.status}${data.report.status !== 'final' ? ' (DRAFT)' : ''}`,
      `Evidence policy: ${opts.sanitizedOnly ? 'sanitized-only (only evidence reviewed as sanitized / no sensitive data)' : 'all active evidence except items marked as containing sensitive data'}`,
      '',
      'Contents:',
      '  manifest.json            Every file in this package with its SHA-256 and size; excluded evidence with reasons.',
      '  evidence/                Original evidence files (and sanitized derivatives) named <EvidenceID>__<original name>.',
      '  evidence-index.csv/json  One row per evidence record (including references and withdrawn items).',
      '  report.html / report.md  Technical report. Open report.html in a browser and print to PDF.',
      '  executive-summary.html   One-page executive summary.',
      '  data/                    Engagement data export (JSON + CSV).',
      '',
      'Integrity note: SHA-256 hashes were calculated by CyberDome from the stored file bytes at import time and',
      'recomputed for this manifest. Matching hashes show the files were not altered since import. A hash alone does',
      'not establish authenticity, who collected the file, or a complete forensic chain of custody.',
      '',
      'AI note: AI drafts are included in data exports only with their review label. Unverified AI text is never part',
      'of the report sections.',
    ].join('\n'),
    'This file',
  );

  const manifest = {
    format: 'cyberdome-evidence-package',
    version: 1,
    generated_at: new Date().toISOString(),
    engagement: { id: eng.id, name: eng.name, client: eng.client_name, is_demo: eng.is_demo },
    report_status: data.report.status,
    evidence_policy: opts.sanitizedOnly ? 'sanitized_only' : 'exclude_contains_sensitive',
    hash_algorithm: 'SHA-256',
    hash_note: 'Hashes identify file contents; they do not by themselves establish authenticity or chain of custody. manifest.json itself is not listed.',
    files: files.map((f) => ({ path: f.path, sha256: sha(f.data), size_bytes: f.data.length, description: f.description })),
    excluded_evidence: excluded,
  };

  const archive = archiver('zip', { zlib: { level: 6 } });
  const done = new Promise<void>((resolve, reject) => {
    archive.on('error', reject);
    out.on('close', () => resolve());
    out.on('finish', () => resolve());
  });
  archive.pipe(out);
  for (const f of files) archive.append(f.data, { name: f.path });
  archive.append(Buffer.from(JSON.stringify(manifest, null, 2)), { name: 'manifest.json' });
  await archive.finalize();
  await done;
  return manifest;
}
