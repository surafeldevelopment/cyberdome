import type { Ctx } from '../../app.js';
import type { Row } from '../../db/index.js';
import { parseJson } from '../../db/index.js';
import { reportReadiness, NARRATIVE_KEYS } from '../readiness.js';
import { AI_TASKS, VERIFIED_REVIEW, type AiTask } from '../../lib/constants.js';
import { nowIso, uid } from '../../lib/codes.js';

const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
export const SECTION_TITLES: Record<string, string> = {
  executive_summary: 'Executive summary',
  methodology: 'Methodology',
  limitations: 'Limitations',
  recommendations: 'Remediation recommendations',
  lessons_learned: 'Lessons learned',
};

export function ensureReport(ctx: Ctx, eid: string): Row {
  const { db } = ctx;
  let r = db.get('SELECT * FROM reports WHERE engagement_id = ?', eid);
  if (!r) {
    const eng = db.get('SELECT client_name FROM engagements WHERE id = ?', eid);
    db.run(
      'INSERT INTO reports (id, engagement_id, title, narrative, narrative_sources, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      uid(), eid, `${eng?.client_name ?? 'CyberDome Corporation'} Security Assessment Report`, '{}', '{}', nowIso(), nowIso(),
    );
    r = db.get('SELECT * FROM reports WHERE engagement_id = ?', eid)!;
  }
  return r;
}

/** Assemble every report section from stored records. Nothing is invented; empty sections stay empty. */
export function assembleReport(ctx: Ctx, eid: string) {
  const { db } = ctx;
  const eng = db.get('SELECT * FROM engagements WHERE id = ?', eid)!;
  const report = ensureReport(ctx, eid);
  const narrative = parseJson<Record<string, string>>(report.narrative, {});
  const narrativeSources = parseJson<Record<string, any>>(report.narrative_sources, {});

  const scope = db.all('SELECT * FROM scope_entries WHERE engagement_id = ? ORDER BY kind, created_at', eid).map((s): Row => ({ ...s, confirmed: !!s.confirmed }));
  const team = db.all('SELECT * FROM team_members WHERE engagement_id = ? ORDER BY created_at', eid);

  // Methodology inputs
  const scanImports = db.all(
    `SELECT s.code, s.format, s.tool, s.tool_version, s.command_line, s.scan_started_at, s.scan_finished_at, s.status, s.hosts_up, s.observations_count, e.code AS evidence_code, e.id AS evidence_id
     FROM scan_imports s LEFT JOIN evidence e ON e.id = s.evidence_id WHERE s.engagement_id = ? ORDER BY s.created_at`, eid,
  );
  const findingImports = db.all(
    `SELECT f.code, f.format, f.scanner, f.status, f.created_count, f.created_at, e.code AS evidence_code, e.id AS evidence_id FROM finding_imports f LEFT JOIN evidence e ON e.id = f.evidence_id WHERE f.engagement_id = ? ORDER BY f.created_at`, eid,
  );
  const logImports = db.all(
    `SELECT l.code, l.format, l.status, l.rows_imported, l.analysis_scope, l.created_at, e.code AS evidence_code, e.id AS evidence_id FROM log_imports l LEFT JOIN evidence e ON e.id = l.evidence_id WHERE l.engagement_id = ? ORDER BY l.created_at`, eid,
  );
  const tools = db.all("SELECT source_tool, COUNT(*) n FROM evidence WHERE engagement_id = ? AND status = 'active' AND trim(source_tool) <> '' GROUP BY source_tool ORDER BY n DESC", eid);
  const sources = db.all("SELECT source_category, COUNT(*) n FROM evidence WHERE engagement_id = ? AND status = 'active' GROUP BY source_category", eid);

  const evCodes = (table: string, col: string, id: string) =>
    db.all(`SELECT e.id, e.code, e.status FROM ${table} l JOIN evidence e ON e.id = l.evidence_id WHERE l.${col} = ? ORDER BY e.code`, id);

  // Recon
  const recon = db.all('SELECT * FROM recon_observations WHERE engagement_id = ? ORDER BY code', eid).map((r): Row => ({ ...r, evidence: evCodes('recon_evidence', 'recon_id', r.id) }));
  const reconByClass = recon.reduce((acc: Record<string, number>, r) => ((acc[r.classification] = (acc[r.classification] ?? 0) + 1), acc), {});

  // Inventory
  const assets = db.all(
    `SELECT a.*, (SELECT COUNT(*) FROM services s WHERE s.asset_id = a.id AND s.state = 'open') AS open_services FROM assets a WHERE a.engagement_id = ? ORDER BY a.code`, eid,
  ).map((a): Row => ({ ...a, hostnames: parseJson<string[]>(a.hostnames, []) }));
  const services = db.all(
    `SELECT s.*, a.code AS asset_code, a.ip, a.hostname FROM services s JOIN assets a ON a.id = s.asset_id WHERE s.engagement_id = ? ORDER BY a.code, s.protocol, s.port`, eid,
  );

  // Findings
  const findings = db
    .all("SELECT * FROM findings WHERE engagement_id = ? AND validation_status <> 'false_positive'", eid)
    .map((f): Row => ({
      ...f,
      cves: parseJson<string[]>(f.cves, []),
      assets: db.all('SELECT a.id, a.code, a.ip, a.hostname FROM finding_assets x JOIN assets a ON a.id = x.asset_id WHERE x.finding_id = ? ORDER BY a.code', f.id),
      services: db.all('SELECT s.id, s.port, s.protocol, s.service_name, a.code AS asset_code FROM finding_services x JOIN services s ON s.id = x.service_id JOIN assets a ON a.id = s.asset_id WHERE x.finding_id = ?', f.id),
      evidence: evCodes('finding_evidence', 'finding_id', f.id),
      tasks: db.all('SELECT * FROM remediation_tasks WHERE finding_id = ? ORDER BY created_at', f.id),
      unverified: ['scanner_reported', 'potential'].includes(f.validation_status),
    }))
    .sort((a, b) => (a.priority_rank ?? 99) - (b.priority_rank ?? 99) || SEV_RANK[a.severity] - SEV_RANK[b.severity] || (b.cvss_score ?? 0) - (a.cvss_score ?? 0) || a.code.localeCompare(b.code, undefined, { numeric: true }));
  const falsePositives = db.all("SELECT code, title FROM findings WHERE engagement_id = ? AND validation_status = 'false_positive' ORDER BY code", eid);
  const topThree = findings.filter((f) => f.priority_rank != null).sort((a, b) => a.priority_rank - b.priority_rank);
  const severityCounts = Object.fromEntries(['critical', 'high', 'medium', 'low', 'info'].map((s) => [s, findings.filter((f) => f.severity === s).length]));

  // Timeline
  const timelineAll = db.all('SELECT * FROM timeline_events WHERE engagement_id = ? ORDER BY normalized_ts IS NULL, normalized_ts, sequence_hint, code', eid).map((t): Row => ({ ...t, evidence: evCodes('timeline_evidence', 'timeline_id', t.id) }));
  const timeline = timelineAll.filter((t) => t.normalized_ts);
  const timelineUnplaced = timelineAll.filter((t) => !t.normalized_ts);
  const indicators = db.all('SELECT * FROM indicators WHERE engagement_id = ? ORDER BY lab, code', eid).map((i): Row => ({ ...i, evidence: evCodes('indicator_evidence', 'indicator_id', i.id) }));

  // Verified ATT&CK mappings only
  const mappings = db
    .all("SELECT * FROM attack_mappings WHERE engagement_id = ? AND status = 'verified' ORDER BY technique_id", eid)
    .map((m): Row => {
      const table = { finding: 'findings', timeline: 'timeline_events', indicator: 'indicators' }[m.target_type as 'finding'];
      const t = table ? db.get(`SELECT code FROM ${table} WHERE id = ?`, m.target_id) : null;
      return { ...m, target_code: t?.code ?? '(deleted record)' };
    });

  // Remediation recommendations from findings + tasks
  const remediation = findings
    .filter((f) => f.remediation?.trim() && f.status !== 'remediated')
    .map((f) => ({ code: f.code, title: f.title, severity: f.severity, priority_rank: f.priority_rank, remediation: f.remediation, owner: f.owner, status: f.status, assets: f.assets.map((a: any) => a.code), tasks: f.tasks }));
  const remediated = findings.filter((f) => f.status === 'remediated').map((f) => ({ code: f.code, title: f.title, retest_notes: f.retest_notes }));

  // Evidence references
  const evidence = db
    .all(
      `SELECT e.id, e.code, e.title, e.kind, e.status, e.original_filename, e.detected_type, e.size_bytes, e.sha256, e.reference_uri, e.source_category, e.source_tool, e.collected_at, e.imported_at, e.confidence, e.sanitization_status, e.observation, e.derived_from_id,
        (SELECT group_concat(a.code, ', ') FROM evidence_assets ea JOIN assets a ON a.id = ea.asset_id WHERE ea.evidence_id = e.id) AS assets
       FROM evidence e WHERE e.engagement_id = ? ORDER BY CAST(substr(e.code, instr(e.code, 'EV-') + 3) AS INTEGER)`,
      eid,
    );
  const screenshots = db
    .all(
      `SELECT s.label, s.lab, e.id AS evidence_id, e.code, e.title, e.detected_type FROM screenshot_requirements s JOIN evidence e ON e.id = s.evidence_id AND e.status = 'active'
       WHERE s.engagement_id = ? ORDER BY s.lab, s.rowid`,
      eid,
    )
    .map((s, i): Row => ({ ...s, figure: i + 1 }));

  // AI use & human verification statement (calculated)
  const sessions = db.all('SELECT id, code, task_type, status, review_status, provider, model, created_at FROM ai_sessions WHERE engagement_id = ? ORDER BY created_at', eid);
  const reviewsBySession = new Map<string, Row>();
  for (const r of db.all("SELECT * FROM human_reviews WHERE engagement_id = ? AND target_type = 'ai_session' ORDER BY created_at", eid)) reviewsBySession.set(r.target_id, r);
  const aiSections = Object.entries(narrativeSources)
    .filter(([, v]) => v?.type === 'ai_session')
    .map(([key, v]) => {
      const s = db.get('SELECT code, review_status FROM ai_sessions WHERE id = ?', v.id);
      return { section: SECTION_TITLES[key] ?? key, key, code: s?.code ?? v.code, review_status: s?.review_status ?? 'missing', reviewer: v.reviewer, reviewed_at: v.reviewed_at };
    });
  const ai = {
    total: sessions.length,
    completed: sessions.filter((s) => s.status === 'completed').length,
    failed: sessions.filter((s) => s.status === 'failed').length,
    verified: sessions.filter((s) => VERIFIED_REVIEW.includes(s.review_status)).length,
    rejected: sessions.filter((s) => s.review_status === 'rejected').length,
    unverified: sessions.filter((s) => s.status === 'completed' && s.review_status === 'unverified').length,
    providers: [...new Set(sessions.map((s) => `${s.provider} / ${s.model}`))],
    sessions: sessions.map((s) => {
      const rv = reviewsBySession.get(s.id);
      return { code: s.code, task: AI_TASKS[s.task_type as AiTask]?.label ?? s.task_type, status: s.status, review_status: s.review_status, reviewer: rv?.reviewer ?? null, reviewed_at: rv?.created_at ?? null, created_at: s.created_at };
    }),
    sections: aiSections,
  };

  return {
    generated_at: nowIso(),
    report: { id: report.id, title: report.title, status: report.status, finalized_by: report.finalized_by, finalized_at: report.finalized_at, updated_at: report.updated_at },
    narrative: Object.fromEntries(NARRATIVE_KEYS.map((k) => [k, narrative[k] ?? ''])),
    narrative_sources: narrativeSources,
    engagement: {
      id: eng.id, name: eng.name, client_name: eng.client_name, purpose: eng.purpose, is_demo: !!eng.is_demo, status: eng.status,
      authorization_ref: eng.authorization_ref, authorization_status: eng.authorization_status, authorization_confirmed_by: eng.authorization_confirmed_by, authorization_confirmed_at: eng.authorization_confirmed_at,
      window_start: eng.window_start, window_end: eng.window_end, timezone: eng.timezone, rules_of_engagement: eng.rules_of_engagement, prohibited_actions: eng.prohibited_actions, approved_evidence_sources: eng.approved_evidence_sources,
    },
    scope: { in: scope.filter((s) => s.kind === 'in'), out: scope.filter((s) => s.kind === 'out') },
    team,
    methodology_inputs: { scan_imports: scanImports, finding_imports: findingImports, log_imports: logImports, tools, sources },
    recon: { items: recon, by_classification: reconByClass, verified: recon.filter((r) => r.verification_status === 'verified').length },
    inventory: { assets, services, open_services: services.filter((s) => s.state === 'open').length },
    findings,
    false_positives: falsePositives,
    severity_counts: severityCounts,
    top_three: topThree,
    timeline,
    timeline_unplaced: timelineUnplaced,
    indicators,
    attack_mappings: mappings,
    remediation,
    remediated,
    evidence,
    screenshots,
    ai,
    readiness: reportReadiness(db, eid),
  };
}

export type ReportData = ReturnType<typeof assembleReport>;
