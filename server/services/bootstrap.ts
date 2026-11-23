import type { Db } from '../db/index.js';
import { nowIso, uid } from '../lib/codes.js';

/** Packet-derived text. These are instructor rules from the NWIT 246 packet, not invented facts. */
export const PACKET_RULES = [
  'Use only systems, networks, files, and targets specifically authorized by the instructor.',
  'Do not scan public Internet targets, other students, college production systems, or any third-party system without written authorization.',
  'If a tool or action is not clearly within scope, stop and ask the instructor before proceeding.',
  'All AI-generated findings must be verified against the actual evidence before being included in the final report.',
  'Do not enter real passwords, API keys, private student data, or sensitive institutional information into public AI tools.',
].join('\n');

export const PACKET_PROHIBITED = [
  'Denial-of-service testing',
  'Destructive testing',
  'Persistence',
  'Credential theft',
  'Data exfiltration against real systems',
  'Scanning public Internet targets, other students, or college production systems',
].join('\n');

export const PACKET_PURPOSE =
  'CyberDome Corporation recently expanded its network and web services and is concerned that new systems may have unnecessary services, weak configurations, or outdated software. Assess the instructor-approved lab environment: identify the exposed attack surface, document weaknesses, interpret evidence, and produce a professional security assessment.';

export const DELIVERABLES: [string, string][] = [
  ['working_platform', 'Working platform (live URL or approved local demo)'],
  ['technical_report', 'Final technical report (PDF or Word)'],
  ['executive_summary', 'One-page executive summary'],
  ['evidence_package', 'Evidence package with evidence index'],
  ['prd', 'Updated PRD showing what was implemented'],
  ['presentation', 'Presentation materials'],
  ['repository_export', 'Repository or project export'],
  ['team_contribution', 'Team contribution statement'],
];

export const SCREENSHOTS: { lab: string; key: string; label: string; kind: 'app_view' | 'tool_activity'; route: string | null }[] = [
  { lab: 'lab1', key: 'lab1_engagement', label: 'Engagement page', kind: 'app_view', route: '/engagement' },
  { lab: 'lab1', key: 'lab1_evidence_items', label: 'At least two evidence items', kind: 'app_view', route: '/evidence' },
  { lab: 'lab1', key: 'lab1_indicator_table', label: 'Completed indicator table', kind: 'app_view', route: '/engagement?tab=indicators' },
  { lab: 'lab2', key: 'lab2_recon_dashboard', label: 'Recon dashboard', kind: 'app_view', route: '/recon' },
  { lab: 'lab2', key: 'lab2_evidence_record', label: 'One recon evidence record', kind: 'app_view', route: '/evidence' },
  { lab: 'lab2', key: 'lab2_ai_summary', label: 'AI summary with student verification note', kind: 'app_view', route: '/ai' },
  { lab: 'lab3', key: 'lab3_scan_command', label: 'Scan command and result (from your terminal)', kind: 'tool_activity', route: null },
  { lab: 'lab3', key: 'lab3_asset_table', label: 'Asset table', kind: 'app_view', route: '/scan' },
  { lab: 'lab3', key: 'lab3_ai_interpretation', label: 'One AI-assisted interpretation', kind: 'app_view', route: '/ai' },
  { lab: 'lab4', key: 'lab4_severity_dashboard', label: 'Severity dashboard', kind: 'app_view', route: '/vulnerabilities' },
  { lab: 'lab4', key: 'lab4_finding_detail', label: 'One detailed finding page', kind: 'app_view', route: '/vulnerabilities' },
  { lab: 'lab4', key: 'lab4_top_three', label: 'Prioritized top-three list', kind: 'app_view', route: '/vulnerabilities?tab=priorities' },
  { lab: 'lab5', key: 'lab5_analysis_filter', label: 'Analysis filter/view', kind: 'app_view', route: '/attack' },
  { lab: 'lab5', key: 'lab5_evidence_table', label: 'Evidence table', kind: 'app_view', route: '/attack?tab=indicators' },
  { lab: 'lab5', key: 'lab5_timeline', label: 'Completed attack timeline', kind: 'app_view', route: '/attack?tab=timeline' },
  { lab: 'lab6', key: 'lab6_ai_page', label: 'AI Analyst page', kind: 'app_view', route: '/ai' },
  { lab: 'lab6', key: 'lab6_grounded_response', label: 'Evidence-grounded AI response', kind: 'app_view', route: '/ai' },
  { lab: 'lab6', key: 'lab6_report_preview', label: 'Final report preview', kind: 'app_view', route: '/reports' },
];

export function seedEngagementScaffolding(db: Db, engagementId: string, title: string) {
  const now = nowIso();
  for (const [key, label] of DELIVERABLES)
    db.run(
      'INSERT OR IGNORE INTO deliverables (id, engagement_id, key, label, status, updated_at) VALUES (?,?,?,?,?,?)',
      uid(), engagementId, key, label, 'not_started', now,
    );
  for (const s of SCREENSHOTS)
    db.run(
      'INSERT OR IGNORE INTO screenshot_requirements (id, engagement_id, lab, key, label, capture_kind, app_route, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      uid(), engagementId, s.lab, s.key, s.label, s.kind, s.route, now,
    );
  db.run(
    'INSERT OR IGNORE INTO reports (id, engagement_id, title, narrative, narrative_sources, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    uid(), engagementId, title, '{}', '{}', now, now,
  );
}

export function createEngagement(db: Db, input: Partial<Record<string, any>> & { name: string; is_demo?: boolean }) {
  const id = uid();
  const now = nowIso();
  db.tx(() => {
    db.insert('engagements', {
      id,
      name: input.name,
      client_name: input.client_name ?? 'CyberDome Corporation',
      purpose: input.purpose ?? '',
      authorization_ref: input.authorization_ref ?? '',
      authorization_status: 'unconfirmed',
      window_start: input.window_start ?? null,
      window_end: input.window_end ?? null,
      timezone: input.timezone ?? 'America/New_York',
      rules_of_engagement: input.rules_of_engagement ?? '',
      prohibited_actions: input.prohibited_actions ?? '',
      approved_evidence_sources: input.approved_evidence_sources ?? '',
      status: 'planning',
      is_demo: input.is_demo ? 1 : 0,
      created_at: now,
      updated_at: now,
    });
    seedEngagementScaffolding(db, id, `${input.client_name ?? 'CyberDome Corporation'} Security Assessment Report`);
  });
  return id;
}

/** First run: create the real (empty) CyberDome engagement. Targets and authorization stay unconfirmed. */
export function ensureBaseline(db: Db) {
  const any = db.scalar<number>('SELECT COUNT(*) FROM engagements WHERE is_demo = 0');
  if (any > 0) return;
  createEngagement(db, {
    name: 'CyberDome Corporation · NWIT 246 Assessment',
    client_name: 'CyberDome Corporation',
    purpose: PACKET_PURPOSE,
    rules_of_engagement: PACKET_RULES,
    prohibited_actions: PACKET_PROHIBITED,
    approved_evidence_sources:
      'Instructor-approved Windows CMD or Kali Linux evidence; instructor-approved scanners against assigned lab targets; instructor-provided PCAP, log, and host evidence packages; instructor-provided scan reports.',
  });
}
