export interface Metric {
  value: number;
  secondary?: number;
  calc: string;
  link: string;
}

export interface MatrixCell {
  id: string;
  asset_id: string;
  asset_code: string;
  ip: string | null;
  hostname: string;
  port: number;
  protocol: string;
  service_name: string | null;
  product: string | null;
  version: string | null;
  version_status: 'detected' | 'inferred' | 'unknown';
  needs_investigation: number;
  worst: number | null;
}

export interface DashboardData {
  series: { days: string[]; evidence: number[]; observations: number[]; log_events: number[]; findings: number[]; calc: string };
  engagement: { id: string; name: string; is_demo: boolean; authorization_status: string; status: string };
  generated_at: string;
  last_collected_at: string | null;
  final_due: string;
  metrics: Record<
    'assets' | 'open_services' | 'findings' | 'awaiting_verification' | 'evidence' | 'unresolved_indicators' | 'lab_completion' | 'report_readiness',
    Metric
  >;
  severity: Record<string, number>;
  validation: Record<string, number>;
  remediation: Record<string, number>;
  remediation_tasks: Record<string, number>;
  latest_import: { type: string; code: string; format: string; status: string; created_at: string; link: string } | null;
  exposed_assets: { id: string; code: string; ip: string | null; hostname: string; criticality: string; open_services: number; open_findings: number; high_findings: number }[];
  top_risks: { id: string; code: string; title: string; severity: string; validation_status: string; status: string; priority_rank: number; priority_rationale: string; assets: string | null; evidence: string | null }[];
  top_risks_unranked: { id: string; code: string; title: string; severity: string; validation_status: string; status: string }[];
  recent_evidence: { id: string; code: string; title: string; source_category: string; source_tool: string; detected_type: string | null; kind: string; imported_at: string; collected_at: string | null }[];
  recent_activity: { id: number; ts: string; actor: string; action: string; entity_type: string; entity_id: string | null; entity_code: string | null; summary: string }[];
  checkpoints: { key: string; date: string; label: string; check: string; passed: boolean; days_away: number }[];
  missing_requirements: { lab: string; id: string; label: string; met: boolean; detail: string; link?: string }[];
  missing_total: number;
  labs: { lab: string; title: string; status: string; met: number; total: number }[];
  readiness: { ready: boolean; blockers?: number; warnings?: number; issues: { severity: 'blocker' | 'warning'; area: string; message: string; link?: string }[] };
  exposure_matrix: MatrixCell[];
}
