import type { Db } from '../db/index.js';
import { parseJson } from '../db/index.js';

export interface ReadinessIssue {
  severity: 'blocker' | 'warning';
  area: string;
  message: string;
  link?: string;
}

export const NARRATIVE_KEYS = ['executive_summary', 'methodology', 'limitations', 'recommendations', 'lessons_learned'] as const;

/** Report readiness: what is missing or unverified before a final report can be exported. */
export function reportReadiness(db: Db, eid: string) {
  const issues: ReadinessIssue[] = [];
  const eng = db.get('SELECT * FROM engagements WHERE id = ?', eid);
  if (!eng) return { ready: false, issues, score: { met: 0, total: 0 } };
  const c = (sql: string, ...p: any[]) => db.scalar<number>(sql, ...p) ?? 0;

  if (!eng.authorization_ref?.trim()) issues.push({ severity: 'warning', area: 'Scope', message: 'Written authorization is not recorded.', link: '/engagement' });
  if (!c("SELECT COUNT(*) FROM scope_entries WHERE engagement_id = ? AND kind = 'in'", eid)) issues.push({ severity: 'blocker', area: 'Scope', message: 'No authorized targets are defined.', link: '/engagement' });
  if (!eng.window_start || !eng.window_end) issues.push({ severity: 'warning', area: 'Scope', message: 'Testing window is not recorded.', link: '/engagement' });
  if (!c('SELECT COUNT(*) FROM team_members WHERE engagement_id = ?', eid)) issues.push({ severity: 'warning', area: 'Team', message: 'No team members recorded for the contribution statement.', link: '/engagement?tab=team' });

  const findings = c("SELECT COUNT(*) FROM findings WHERE engagement_id = ? AND validation_status <> 'false_positive'", eid);
  if (!findings) issues.push({ severity: 'blocker', area: 'Findings', message: 'No findings recorded.', link: '/vulnerabilities' });
  const noEvidence = db.all(
    "SELECT code FROM findings f WHERE engagement_id = ? AND validation_status <> 'false_positive' AND NOT EXISTS (SELECT 1 FROM finding_evidence fe JOIN evidence e ON e.id = fe.evidence_id AND e.status = 'active' WHERE fe.finding_id = f.id)",
    eid,
  );
  if (noEvidence.length) issues.push({ severity: 'blocker', area: 'Findings', message: `Findings without active supporting evidence: ${noEvidence.map((x) => x.code).join(', ')}`, link: '/vulnerabilities' });
  const noRem = db.all("SELECT code FROM findings WHERE engagement_id = ? AND validation_status <> 'false_positive' AND trim(remediation) = ''", eid);
  if (noRem.length) issues.push({ severity: 'warning', area: 'Findings', message: `Findings without remediation: ${noRem.map((x) => x.code).join(', ')}`, link: '/vulnerabilities' });
  const unvalidated = c("SELECT COUNT(*) FROM findings WHERE engagement_id = ? AND validation_status IN ('scanner_reported','potential') AND status <> 'remediated'", eid);
  if (unvalidated) issues.push({ severity: 'warning', area: 'Findings', message: `${unvalidated} finding(s) are not analyst-validated; the report will label them as unverified.`, link: '/vulnerabilities' });
  const ranked = db.all('SELECT code, priority_rationale FROM findings WHERE engagement_id = ? AND priority_rank IS NOT NULL', eid);
  if (ranked.length < Math.min(3, findings)) issues.push({ severity: 'blocker', area: 'Prioritization', message: 'Top-three priorities are not fully ranked.', link: '/vulnerabilities?tab=priorities' });
  const noRationale = ranked.filter((r) => !r.priority_rationale?.trim());
  if (noRationale.length) issues.push({ severity: 'blocker', area: 'Prioritization', message: `Prioritization rationale missing for ${noRationale.map((r) => r.code).join(', ')}.`, link: '/vulnerabilities?tab=priorities' });

  const sensitive = c("SELECT COUNT(*) FROM evidence WHERE engagement_id = ? AND status = 'active' AND sanitization_status = 'contains_sensitive'", eid);
  if (sensitive) issues.push({ severity: 'warning', area: 'Evidence', message: `${sensitive} evidence item(s) are marked as containing sensitive data; create sanitized derivatives before packaging.`, link: '/evidence?sanitization_status=contains_sensitive' });
  const unreviewed = c("SELECT COUNT(*) FROM evidence WHERE engagement_id = ? AND status = 'active' AND sanitization_status = 'not_reviewed'", eid);
  if (unreviewed) issues.push({ severity: 'warning', area: 'Evidence', message: `${unreviewed} evidence item(s) have not been reviewed for sanitization.`, link: '/evidence?sanitization_status=not_reviewed' });
  if (c('SELECT COUNT(*) FROM timeline_events WHERE engagement_id = ?', eid) < 5) issues.push({ severity: 'warning', area: 'Timeline', message: 'Fewer than five timeline events recorded.', link: '/attack?tab=timeline' });

  const report = db.get('SELECT * FROM reports WHERE engagement_id = ?', eid);
  const narrative = parseJson<Record<string, string>>(report?.narrative, {});
  const sources = parseJson<Record<string, any>>(report?.narrative_sources, {});
  if (!narrative.executive_summary?.trim()) issues.push({ severity: 'blocker', area: 'Narrative', message: 'Executive summary is empty.', link: '/reports' });
  if (!narrative.methodology?.trim()) issues.push({ severity: 'warning', area: 'Narrative', message: 'Methodology section is empty.', link: '/reports' });
  if (!narrative.limitations?.trim()) issues.push({ severity: 'warning', area: 'Narrative', message: 'Limitations section is empty.', link: '/reports' });
  for (const [key, src] of Object.entries(sources)) {
    if (src?.type === 'ai_session') {
      const s = db.get('SELECT code, review_status FROM ai_sessions WHERE id = ?', src.id);
      if (!s || !['verified', 'verified_with_edits'].includes(s.review_status))
        issues.push({ severity: 'blocker', area: 'AI', message: `Section “${key.replace(/_/g, ' ')}” uses AI text (${s?.code ?? 'missing session'}) that is not verified.`, link: '/ai' });
    }
  }
  const unverifiedAi = c("SELECT COUNT(*) FROM ai_sessions WHERE engagement_id = ? AND status = 'completed' AND review_status = 'unverified'", eid);
  if (unverifiedAi) issues.push({ severity: 'warning', area: 'AI', message: `${unverifiedAi} AI draft(s) are unverified. They are excluded from the report until reviewed.`, link: '/ai' });
  const proposedMappings = c("SELECT COUNT(*) FROM attack_mappings WHERE engagement_id = ? AND status = 'proposed'", eid);
  if (proposedMappings) issues.push({ severity: 'warning', area: 'AI', message: `${proposedMappings} ATT&CK mapping(s) are proposed but not verified; they will be excluded.`, link: '/attack' });

  const blockers = issues.filter((i) => i.severity === 'blocker').length;
  return { ready: blockers === 0, blockers, warnings: issues.length - blockers, issues };
}
