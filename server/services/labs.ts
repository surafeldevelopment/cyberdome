import type { Db } from '../db/index.js';

export interface Requirement {
  id: string;
  label: string;
  met: boolean;
  detail: string;
  link?: string;
}
export interface LabStatus {
  lab: string;
  title: string;
  status: 'not_started' | 'in_progress' | 'requirements_met' | 'signed_off';
  requirements: Requirement[];
  met: number;
  total: number;
  signoff: { signed_off_by: string; signed_off_at: string; notes: string } | null;
}

const LABS: Record<string, string> = {
  lab1: 'Lab 1: Engagement scope + signs of compromise',
  lab2: 'Lab 2: Reconnaissance and OSINT',
  lab3: 'Lab 3: Network scanning and enumeration',
  lab4: 'Lab 4: Vulnerability analysis and risk prioritization',
  lab5: 'Lab 5: Attack evidence analysis',
  lab6: 'Lab 6: AI Security Analyst + final reporting',
};

const count = (db: Db, sql: string, ...p: any[]) => db.scalar<number>(sql, ...p) ?? 0;
const req = (id: string, label: string, have: number, need: number, link?: string, unit = ''): Requirement => ({
  id, label, met: have >= need, detail: need === 1 && have >= 1 ? `${have}${unit}` : `${have} of ${need}${unit}`, link,
});
const bool = (id: string, label: string, met: boolean, detail: string, link?: string): Requirement => ({ id, label, met, detail, link });

function verifiedAi(db: Db, eid: string, task: string) {
  return count(
    db,
    `SELECT COUNT(*) FROM ai_sessions s WHERE s.engagement_id = ? AND s.task_type = ? AND s.status = 'completed'
       AND s.review_status IN ('verified','verified_with_edits')
       AND EXISTS (SELECT 1 FROM human_reviews r WHERE r.target_type = 'ai_session' AND r.target_id = s.id AND length(trim(r.notes)) > 0)`,
    eid, task,
  );
}

function screenshots(db: Db, eid: string, lab: string): Requirement {
  const total = count(db, 'SELECT COUNT(*) FROM screenshot_requirements WHERE engagement_id = ? AND lab = ?', eid, lab);
  const have = count(db, `SELECT COUNT(*) FROM screenshot_requirements s JOIN evidence e ON e.id = s.evidence_id AND e.status = 'active' WHERE s.engagement_id = ? AND s.lab = ?`, eid, lab);
  return req(`${lab}_screens`, 'Required screenshots attached', have, total, '/tracker');
}

export function computeLabs(db: Db, eid: string): LabStatus[] {
  const eng = db.get('SELECT * FROM engagements WHERE id = ?', eid);
  if (!eng) return [];
  const out: Record<string, Requirement[]> = {};

  // Lab 1
  const inScope = count(db, "SELECT COUNT(*) FROM scope_entries WHERE engagement_id = ? AND kind = 'in'", eid);
  const roles = count(db, "SELECT COUNT(*) FROM team_members WHERE engagement_id = ? AND trim(role) <> ''", eid);
  const lab1Complete = count(
    db,
    `SELECT COUNT(*) FROM indicators i WHERE i.engagement_id = ? AND i.lab = 'lab1' AND trim(i.observation) <> '' AND trim(i.why_suspicious) <> ''
       AND trim(i.additional_evidence_needed) <> '' AND i.assessment <> 'unassessed'
       AND EXISTS (SELECT 1 FROM indicator_evidence ie JOIN evidence e ON e.id = ie.evidence_id AND e.status = 'active' WHERE ie.indicator_id = i.id)`,
    eid,
  );
  const fieldsDone = [eng.client_name, eng.purpose, eng.authorization_ref, eng.rules_of_engagement, eng.prohibited_actions].every((s: string) => s?.trim()) && !!eng.window_start && !!eng.window_end && inScope > 0;
  out.lab1 = [
    bool('lab1_scope', 'Client, purpose, authorized scope, testing window, and prohibited actions documented', fieldsDone, fieldsDone ? 'Complete' : 'Missing fields', '/engagement'),
    bool('lab1_auth', 'Written authorization recorded', !!eng.authorization_ref?.trim(), eng.authorization_ref?.trim() ? 'Recorded' : 'Not recorded', '/engagement'),
    req('lab1_roles', 'Team roles assigned', roles, 1, '/engagement?tab=team', ' members with roles'),
    req('lab1_indicators', 'Signs of compromise documented with evidence, reasoning, and assessment', lab1Complete, 5, '/engagement?tab=indicators', ' complete'),
    screenshots(db, eid, 'lab1'),
  ];

  // Lab 2
  const reconComplete = count(
    db,
    `SELECT COUNT(*) FROM recon_observations r WHERE r.engagement_id = ? AND trim(r.source) <> '' AND trim(r.analyst_notes) <> '' AND trim(r.next_step) <> ''`,
    eid,
  );
  const reconWithEvidence = count(db, 'SELECT COUNT(DISTINCT r.id) FROM recon_observations r JOIN recon_evidence re ON re.recon_id = r.id WHERE r.engagement_id = ?', eid);
  out.lab2 = [
    req('lab2_obs', 'Recon observations with source, analyst note, and next step', reconComplete, 5, '/recon'),
    req('lab2_evidence', 'Recon observations linked to evidence', reconWithEvidence, 1, '/recon'),
    req('lab2_ai', 'AI recon summary verified with a student verification note', verifiedAi(db, eid, 'recon_summary'), 1, '/ai'),
    screenshots(db, eid, 'lab2'),
  ];

  // Lab 3
  const scans = count(db, "SELECT COUNT(*) FROM scan_imports WHERE engagement_id = ? AND status IN ('complete','partial') AND evidence_id IS NOT NULL", eid);
  const purposes = count(db, "SELECT COUNT(*) FROM services WHERE engagement_id = ? AND trim(normal_purpose) <> ''", eid);
  const investigate = count(db, "SELECT COUNT(*) FROM services WHERE engagement_id = ? AND needs_investigation = 1 AND trim(investigation_reason) <> ''", eid);
  const openSvc = count(db, "SELECT COUNT(*) FROM services WHERE engagement_id = ? AND state = 'open'", eid);
  out.lab3 = [
    req('lab3_scan', 'Scanner output imported and stored in the Evidence Locker', scans, 1, '/scan?tab=history', ' scan imports'),
    req('lab3_services', 'Open services recorded (host, port, protocol, state, service, version)', openSvc, 1, '/scan?tab=services'),
    req('lab3_purpose', 'Services correlated with their normal purpose', purposes, 5, '/scan?tab=services'),
    req('lab3_investigate', 'Service flagged for further investigation with reason', investigate, 1, '/scan?tab=services'),
    req('lab3_ai', 'AI interpretation of completed scan verified', verifiedAi(db, eid, 'scan_interpretation'), 1, '/ai'),
    screenshots(db, eid, 'lab3'),
  ];

  // Lab 4
  const findingsComplete = count(
    db,
    `SELECT COUNT(*) FROM findings f WHERE f.engagement_id = ? AND f.validation_status <> 'false_positive'
       AND trim(f.description) <> '' AND trim(f.impact) <> '' AND trim(f.remediation) <> ''
       AND EXISTS (SELECT 1 FROM finding_assets fa WHERE fa.finding_id = f.id)
       AND EXISTS (SELECT 1 FROM finding_evidence fe JOIN evidence e ON e.id = fe.evidence_id AND e.status='active' WHERE fe.finding_id = f.id)`,
    eid,
  );
  const top3 = count(db, "SELECT COUNT(*) FROM findings WHERE engagement_id = ? AND priority_rank IS NOT NULL AND trim(priority_rationale) <> ''", eid);
  out.lab4 = [
    req('lab4_findings', 'Findings with asset, description, severity, evidence, impact, and remediation', findingsComplete, 5, '/vulnerabilities'),
    req('lab4_top3', 'Top-three priorities ranked with written rationale', top3, 3, '/vulnerabilities?tab=priorities'),
    req('lab4_ai', 'AI plain-language explanation verified against scanner evidence', verifiedAi(db, eid, 'explain_nontechnical'), 1, '/ai'),
    screenshots(db, eid, 'lab4'),
  ];

  // Lab 5
  const lab5Ind = count(
    db,
    `SELECT COUNT(*) FROM indicators i WHERE i.engagement_id = ? AND i.lab = 'lab5' AND trim(i.analyst_assessment || i.why_suspicious) <> ''
       AND EXISTS (SELECT 1 FROM indicator_evidence ie WHERE ie.indicator_id = i.id)`,
    eid,
  );
  const tl = count(db, 'SELECT COUNT(DISTINCT t.id) FROM timeline_events t JOIN timeline_evidence te ON te.timeline_id = t.id WHERE t.engagement_id = ?', eid);
  const tlInterpreted = count(db, "SELECT COUNT(*) FROM timeline_events WHERE engagement_id = ? AND trim(student_interpretation) <> ''", eid);
  // AI timeline summary only counts if it was generated after at least 5 timeline events already existed.
  const aiAfter = count(
    db,
    `SELECT COUNT(*) FROM ai_sessions s WHERE s.engagement_id = ? AND s.task_type = 'timeline_summary' AND s.review_status IN ('verified','verified_with_edits')
       AND (SELECT COUNT(*) FROM timeline_events t WHERE t.engagement_id = s.engagement_id AND t.created_at <= s.created_at) >= 5`,
    eid,
  );
  out.lab5 = [
    req('lab5_indicators', 'Meaningful indicators/events with evidence and interpretation', lab5Ind, 5, '/attack?tab=indicators'),
    req('lab5_timeline', 'Timeline events linked to evidence', tl, 5, '/attack?tab=timeline'),
    req('lab5_interpretation', 'Student interpretation recorded on timeline events', tlInterpreted, 5, '/attack?tab=timeline'),
    req('lab5_ai', 'AI timeline summary generated after the team analysis and verified', aiAfter, 1, '/ai'),
    screenshots(db, eid, 'lab5'),
  ];

  // Lab 6
  const caps: [string, string][] = [
    ['assessment_summary', 'Assessment summary'],
    ['top_risks', 'Top-three risks with Evidence IDs'],
    ['explain_nontechnical', 'Non-technical explanation of a finding'],
    ['next_step', 'Next authorized investigative step'],
    ['remediation_priorities', 'Remediation priorities'],
    ['executive_summary', 'Executive summary draft'],
  ];
  const mappings = count(db, "SELECT COUNT(*) FROM attack_mappings WHERE engagement_id = ? AND status = 'verified'", eid);
  const report = db.get('SELECT narrative FROM reports WHERE engagement_id = ?', eid);
  const narrative = report ? JSON.parse(report.narrative || '{}') : {};
  out.lab6 = [
    ...caps.map(([k, label]) => req(`lab6_${k}`, `Verified AI capability: ${label}`, verifiedAi(db, eid, k), 1, '/ai')),
    bool('lab6_attack', 'ATT&CK mapping verified by a human (only where evidence supports it)', mappings > 0, `${mappings} verified mappings`, '/attack'),
    bool('lab6_exec', 'Executive summary reviewed and placed in the report', !!narrative.executive_summary?.trim(), narrative.executive_summary?.trim() ? 'Present' : 'Missing', '/reports'),
    screenshots(db, eid, 'lab6'),
  ];

  const signoffs = Object.fromEntries(db.all('SELECT * FROM lab_signoffs WHERE engagement_id = ?', eid).map((s) => [s.lab, s]));
  return Object.entries(out).map(([lab, requirements]) => {
    const met = requirements.filter((r) => r.met).length;
    const all = met === requirements.length;
    const so = signoffs[lab] ?? null;
    return {
      lab,
      title: LABS[lab],
      requirements,
      met,
      total: requirements.length,
      signoff: so ? { signed_off_by: so.signed_off_by, signed_off_at: so.signed_off_at, notes: so.notes } : null,
      status: all && so ? 'signed_off' : all ? 'requirements_met' : met > 0 ? 'in_progress' : 'not_started',
    } as LabStatus;
  });
}
