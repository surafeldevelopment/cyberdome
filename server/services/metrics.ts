import type { Db } from '../db/index.js';
import { computeLabs } from './labs.js';
import { reportReadiness } from './readiness.js';
import { CHECKPOINTS, FINAL_DUE } from '../lib/constants.js';

/**
 * Every metric is calculated from stored records at request time and ships with:
 *  - `calc`: a plain-language counting rule
 *  - `link`: the app route that lists the underlying records
 * Nothing here is hardcoded or simulated.
 */
export function dashboard(db: Db, eid: string) {
  const c = (sql: string, ...p: any[]) => db.scalar<number>(sql, ...p) ?? 0;
  const eng = db.get('SELECT * FROM engagements WHERE id = ?', eid)!;

  const assets = c('SELECT COUNT(*) FROM assets WHERE engagement_id = ?', eid);
  const assetsWithOpen = c("SELECT COUNT(DISTINCT asset_id) FROM services WHERE engagement_id = ? AND state = 'open'", eid);
  const openServices = c("SELECT COUNT(*) FROM services WHERE engagement_id = ? AND state = 'open'", eid);
  const observations = c('SELECT COUNT(*) FROM service_observations WHERE engagement_id = ?', eid);

  const sevRows = db.all(
    "SELECT severity, COUNT(*) n FROM findings WHERE engagement_id = ? AND validation_status <> 'false_positive' GROUP BY severity",
    eid,
  );
  const severity = Object.fromEntries(['critical', 'high', 'medium', 'low', 'info'].map((s) => [s, sevRows.find((r) => r.severity === s)?.n ?? 0]));
  const totalFindings = Object.values(severity).reduce((a: number, b: any) => a + b, 0);
  const falsePositives = c("SELECT COUNT(*) FROM findings WHERE engagement_id = ? AND validation_status = 'false_positive'", eid);
  const awaiting = c("SELECT COUNT(*) FROM findings WHERE engagement_id = ? AND validation_status IN ('scanner_reported','potential') AND status <> 'remediated'", eid);
  const statusRows = db.all("SELECT status, COUNT(*) n FROM findings WHERE engagement_id = ? AND validation_status <> 'false_positive' GROUP BY status", eid);
  const remediation = Object.fromEntries(['open', 'in_progress', 'remediated', 'risk_accepted'].map((s) => [s, statusRows.find((r) => r.status === s)?.n ?? 0]));
  const validationRows = db.all('SELECT validation_status, COUNT(*) n FROM findings WHERE engagement_id = ? GROUP BY validation_status', eid);
  const validation = Object.fromEntries(['scanner_reported', 'potential', 'validated', 'false_positive'].map((s) => [s, validationRows.find((r) => r.validation_status === s)?.n ?? 0]));

  const evidenceItems = c("SELECT COUNT(*) FROM evidence WHERE engagement_id = ? AND status = 'active'", eid);
  const unresolved = c("SELECT COUNT(*) FROM indicators WHERE engagement_id = ? AND assessment IN ('unassessed','suspicious','requires_more_evidence')", eid);
  const indicatorsTotal = c('SELECT COUNT(*) FROM indicators WHERE engagement_id = ?', eid);

  const latestImport = db.get(
    `SELECT * FROM (
       SELECT 'scan' AS type, code, format, status, created_at, '/scan?tab=history' AS link FROM scan_imports WHERE engagement_id = ?
       UNION ALL SELECT 'findings', code, format, status, created_at, '/vulnerabilities?tab=imports' FROM finding_imports WHERE engagement_id = ?
       UNION ALL SELECT 'logs', code, format, status, created_at, '/attack?tab=imports' FROM log_imports WHERE engagement_id = ?
     ) ORDER BY created_at DESC LIMIT 1`,
    eid, eid, eid,
  );
  const lastCollected = db.get(
    `SELECT MAX(ts) AS ts FROM (
       SELECT MAX(collected_at) ts FROM evidence WHERE engagement_id = ? AND status = 'active'
       UNION ALL SELECT MAX(observed_at) FROM service_observations WHERE engagement_id = ?
     )`,
    eid, eid,
  )?.ts ?? null;

  const exposed = db.all(
    `SELECT a.id, a.code, a.ip, a.hostname, a.criticality,
        (SELECT COUNT(*) FROM services s WHERE s.asset_id = a.id AND s.state = 'open') AS open_services,
        (SELECT COUNT(*) FROM finding_assets fa JOIN findings f ON f.id = fa.finding_id WHERE fa.asset_id = a.id AND f.validation_status <> 'false_positive' AND f.status NOT IN ('remediated')) AS open_findings,
        (SELECT COUNT(*) FROM finding_assets fa JOIN findings f ON f.id = fa.finding_id WHERE fa.asset_id = a.id AND f.validation_status <> 'false_positive' AND f.status NOT IN ('remediated') AND f.severity IN ('critical','high')) AS high_findings
     FROM assets a WHERE a.engagement_id = ?
     ORDER BY high_findings DESC, open_findings DESC, open_services DESC, a.code LIMIT 6`,
    eid,
  ).filter((a) => a.open_services > 0 || a.open_findings > 0);

  const topRisks = db.all(
    `SELECT f.id, f.code, f.title, f.severity, f.validation_status, f.status, f.priority_rank, f.priority_rationale,
       (SELECT group_concat(a.code, ', ') FROM finding_assets fa JOIN assets a ON a.id = fa.asset_id WHERE fa.finding_id = f.id) AS assets,
       (SELECT group_concat(e.code, ', ') FROM finding_evidence fe JOIN evidence e ON e.id = fe.evidence_id WHERE fe.finding_id = f.id) AS evidence
     FROM findings f WHERE f.engagement_id = ? AND f.priority_rank IS NOT NULL ORDER BY f.priority_rank`,
    eid,
  );
  const unrankedTop = topRisks.length
    ? []
    : db.all(
        `SELECT f.id, f.code, f.title, f.severity, f.validation_status, f.status FROM findings f WHERE f.engagement_id = ? AND f.validation_status <> 'false_positive' AND f.status <> 'remediated'
         ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, f.cvss_score DESC LIMIT 3`,
        eid,
      );

  const tasks = db.all('SELECT status, COUNT(*) n FROM remediation_tasks WHERE engagement_id = ? GROUP BY status', eid);
  const recentEvidence = db.all("SELECT id, code, title, source_category, source_tool, detected_type, kind, imported_at, collected_at FROM evidence WHERE engagement_id = ? AND status = 'active' ORDER BY imported_at DESC LIMIT 5", eid);
  const recentActivity = db.all('SELECT * FROM activity WHERE engagement_id = ? ORDER BY id DESC LIMIT 12', eid);

  const labs = computeLabs(db, eid);
  const reqTotal = labs.reduce((a, l) => a + l.total, 0);
  const reqMet = labs.reduce((a, l) => a + l.met, 0);
  const readiness = reportReadiness(db, eid);

  const today = new Date().toISOString().slice(0, 10);
  const checkpoints = CHECKPOINTS.map((cp) => ({ ...cp, passed: cp.date < today, days_away: Math.round((Date.parse(cp.date) - Date.parse(today)) / 86400000) }));
  const missing = labs.flatMap((l) => l.requirements.filter((r) => !r.met).map((r) => ({ lab: l.lab, ...r })));

  // Exposure matrix: assets x open ports (hero visual)
  const matrixRows = db.all(
    `SELECT s.id, s.asset_id, a.code AS asset_code, a.ip, a.hostname, s.port, s.protocol, s.service_name, s.product, s.version, s.version_status, s.needs_investigation,
       (SELECT MAX(CASE f.severity WHEN 'critical' THEN 5 WHEN 'high' THEN 4 WHEN 'medium' THEN 3 WHEN 'low' THEN 2 ELSE 1 END)
          FROM finding_services fs JOIN findings f ON f.id = fs.finding_id WHERE fs.service_id = s.id AND f.validation_status <> 'false_positive' AND f.status <> 'remediated') AS worst
     FROM services s JOIN assets a ON a.id = s.asset_id WHERE s.engagement_id = ? AND s.state = 'open' ORDER BY a.code, s.protocol, s.port LIMIT 400`,
    eid,
  );

  // Daily series from stored timestamps (no interpolation, no invented points).
  const perDay = (sql: string) => Object.fromEntries(db.all(sql, eid).map((r) => [r.d, r.n]));
  const seriesSrc = {
    evidence: perDay("SELECT substr(COALESCE(collected_at, imported_at),1,10) d, COUNT(*) n FROM evidence WHERE engagement_id = ? AND status = 'active' GROUP BY d"),
    observations: perDay('SELECT substr(observed_at,1,10) d, COUNT(*) n FROM service_observations WHERE engagement_id = ? AND observed_at IS NOT NULL GROUP BY d'),
    log_events: perDay('SELECT substr(normalized_ts,1,10) d, COUNT(*) n FROM log_events WHERE engagement_id = ? AND normalized_ts IS NOT NULL GROUP BY d'),
    findings: perDay('SELECT substr(created_at,1,10) d, COUNT(*) n FROM findings WHERE engagement_id = ? GROUP BY d'),
  };
  const allDays = Object.values(seriesSrc).flatMap((m) => Object.keys(m)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const days: string[] = [];
  if (allDays.length) {
    let t = Date.parse(allDays[0] + 'T00:00:00Z');
    const end = Date.parse(allDays[allDays.length - 1] + 'T00:00:00Z');
    while (t <= end && days.length < 400) {
      days.push(new Date(t).toISOString().slice(0, 10));
      t += 86400000;
    }
  }
  const series = {
    days,
    evidence: days.map((d) => seriesSrc.evidence[d] ?? 0),
    observations: days.map((d) => seriesSrc.observations[d] ?? 0),
    log_events: days.map((d) => seriesSrc.log_events[d] ?? 0),
    findings: days.map((d) => seriesSrc.findings[d] ?? 0),
    calc: 'Per-day counts grouped by UTC date: evidence by collection time (import time when no collection time was supplied), service observations by scan time, log events by normalized event time, findings by record creation time. Days with no records count as zero.',
  };

  return {
    series,
    engagement: { id: eng.id, name: eng.name, is_demo: !!eng.is_demo, authorization_status: eng.authorization_status, status: eng.status },
    generated_at: new Date().toISOString(),
    last_collected_at: lastCollected,
    final_due: FINAL_DUE,
    metrics: {
      assets: { value: assets, secondary: assetsWithOpen, calc: 'Distinct hosts recorded for this engagement (one asset per IP address). Secondary value: hosts with at least one currently open service.', link: '/scan' },
      open_services: { value: openServices, secondary: observations, calc: 'Distinct (asset, port, protocol) combinations whose most recent observation state is “open”. Re-importing the same scan updates last-seen times; it never adds rows. Secondary value: total historical observations across all scan imports.', link: '/scan?tab=services&state=open' },
      findings: { value: totalFindings, secondary: falsePositives, calc: 'Findings for this engagement excluding those marked false positive (secondary value).', link: '/vulnerabilities' },
      awaiting_verification: { value: awaiting, calc: 'Findings whose validation status is “scanner-reported” or “potential. Requires verification”, excluding remediated ones.', link: '/vulnerabilities?validation=unverified' },
      evidence: { value: evidenceItems, calc: 'Active (not withdrawn) artifacts in the Evidence Locker.', link: '/evidence' },
      unresolved_indicators: { value: unresolved, secondary: indicatorsTotal, calc: 'Indicators assessed as suspicious, requiring additional evidence, or not yet assessed. Secondary value: all indicators.', link: '/attack?tab=indicators&unresolved=1' },
      lab_completion: { value: reqMet, secondary: reqTotal, calc: 'Lab requirements met, checked against stored records (counts, links, verified AI reviews, attached screenshots). A page existing never counts as completion.', link: '/tracker' },
      report_readiness: { value: readiness.blockers ?? 0, secondary: readiness.warnings ?? 0, calc: 'Number of blocking issues (and warnings) found by the report readiness check.', link: '/reports' },
    },
    severity,
    validation,
    remediation,
    remediation_tasks: Object.fromEntries(tasks.map((t) => [t.status, t.n])),
    latest_import: latestImport ?? null,
    exposed_assets: exposed,
    top_risks: topRisks,
    top_risks_unranked: unrankedTop,
    recent_evidence: recentEvidence,
    recent_activity: recentActivity,
    checkpoints,
    missing_requirements: missing.slice(0, 12),
    missing_total: missing.length,
    labs: labs.map((l) => ({ lab: l.lab, title: l.title, status: l.status, met: l.met, total: l.total })),
    readiness,
    exposure_matrix: matrixRows,
  };
}
