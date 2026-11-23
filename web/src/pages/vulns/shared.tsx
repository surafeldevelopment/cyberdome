import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, CircleDot, Clock, ShieldOff } from 'lucide-react';
import { api } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { Badge } from '../../components/ui';
import { StatusPill } from '../../components/kit';
import type { Severity } from '../../lib/types';

export interface FindingRow {
  id: string;
  code: string;
  title: string;
  description: string;
  severity: Severity;
  severity_basis: 'scanner' | 'analyst' | 'cvss';
  cves: string[];
  cvss_score: number | null;
  cvss_version: string | null;
  cvss_vector: string | null;
  cvss_source: string | null;
  impact: string;
  remediation: string;
  validation_status: 'scanner_reported' | 'potential' | 'validated' | 'false_positive';
  validation_notes: string;
  validated_by: string | null;
  validated_at: string | null;
  status: 'open' | 'in_progress' | 'remediated' | 'risk_accepted';
  owner: string;
  priority_rank: number | null;
  priority_rationale: string;
  f_evidence_strength: number | null;
  f_exposure: number | null;
  f_impact: number | null;
  f_asset_importance: number | null;
  f_remediation_available: number | null;
  retest_notes: string;
  scanner_name: string | null;
  scanner_plugin_id: string | null;
  origin: 'import' | 'manual';
  import_code: string | null;
  assets: { id: string; code: string; ip: string | null; hostname: string }[];
  evidence: { id: string; code: string; status: string; title?: string }[];
  service_labels: string | null;
  task_count: number;
  tasks_closed: number;
  created_at: string;
  updated_at: string;
}

export interface FindingDetailData extends FindingRow {
  services: { id: string; port: number; protocol: string; state: string; service_name: string | null; product: string | null; version: string | null; version_status: string; asset_id: string; asset_code: string; ip: string | null }[];
  tasks: Task[];
  attack_mappings: { id: string; technique_id: string; technique_name: string; tactics: string; rationale: string; origin: string; status: string }[];
  reviews: { id: string; reviewer: string; decision: string; notes: string; created_at: string }[];
  import: { id: string; code: string; format: string; scanner: string; created_at: string; evidence_id: string; evidence_code: string } | null;
}

export interface Task {
  id: string;
  finding_id: string;
  title: string;
  owner: string;
  status: 'todo' | 'in_progress' | 'done' | 'wont_fix';
  due_date: string | null;
  notes: string;
  finding_code?: string;
  finding_title?: string;
  severity?: Severity;
}

export const FACTORS: { key: keyof FindingRow; label: string; help: string; scale: [string, string, string, string] }[] = [
  { key: 'f_evidence_strength', label: 'Evidence strength', help: 'How directly the stored evidence shows the weakness.', scale: ['None', 'Indirect (banner/version only)', 'Scanner-confirmed', 'Analyst-reproduced'] },
  { key: 'f_exposure', label: 'Exposure', help: 'Who can reach the affected service.', scale: ['Not reachable', 'Local only', 'Internal network', 'Broadly reachable'] },
  { key: 'f_impact', label: 'Impact', help: 'Consequence if exploited (confidentiality, integrity, availability).', scale: ['Negligible', 'Limited', 'Significant', 'Severe'] },
  { key: 'f_asset_importance', label: 'Asset importance', help: 'Business importance of the affected asset to CyberDome.', scale: ['Unknown', 'Low', 'Medium', 'High'] },
  { key: 'f_remediation_available', label: 'Remediation available', help: 'How readily a fix or mitigation can be applied.', scale: ['None known', 'Workaround only', 'Fix with effort', 'Simple fix available'] },
];

export const VALIDATION_HELP: Record<string, string> = {
  scanner_reported: 'Reported by a scanner. Not yet confirmed by an analyst.',
  potential: 'Possible issue that needs verification against evidence.',
  validated: 'An analyst confirmed the issue against linked evidence and recorded how.',
  false_positive: 'An analyst determined the reported issue does not apply, and recorded why.',
};

export const STATUS_LABEL: Record<string, string> = { open: 'Open', in_progress: 'In progress', remediated: 'Remediated', risk_accepted: 'Risk accepted' };

export function FindingStatusBadge({ status }: { status: string }) {
  if (status === 'remediated') return <Badge tone="ok" icon={<CheckCircle2 />}>Remediated</Badge>;
  if (status === 'in_progress') return <Badge tone="accent" icon={<Clock />}>In progress</Badge>;
  if (status === 'risk_accepted') return <Badge tone="muted" icon={<ShieldOff />}>Risk accepted</Badge>;
  return <Badge icon={<CircleDot />}>Open</Badge>;
}

export const VALIDATION_LABEL: Record<string, string> = { scanner_reported: 'Scanner-reported', potential: 'Potential (verify)', validated: 'Analyst-validated', false_positive: 'False positive' };
const VALIDATION_TONE: Record<string, 'ok' | 'warn' | 'muted'> = { scanner_reported: 'warn', potential: 'warn', validated: 'ok', false_positive: 'muted' };
const STATUS_TONE: Record<string, 'ok' | 'warn' | 'info' | 'muted'> = { open: 'warn', in_progress: 'info', remediated: 'ok', risk_accepted: 'muted' };

/** Dot pill for validation state (text carries the meaning). */
export function ValidationPill({ value }: { value: string }) {
  return <StatusPill tone={VALIDATION_TONE[value] ?? 'muted'}>{VALIDATION_LABEL[value] ?? value}</StatusPill>;
}
/** Dot pill for remediation status. */
export function StatusPillFor({ status }: { status: string }) {
  return <StatusPill tone={STATUS_TONE[status] ?? 'muted'}>{STATUS_LABEL[status] ?? status}</StatusPill>;
}

export function useFindings(params = '') {
  const { base, eid } = useEngagement();
  return useQuery({
    queryKey: ['findings', eid, params],
    queryFn: () => api.get<{ items: FindingRow[]; total: number }>(`${base}/findings${params}`),
    enabled: !!eid,
  });
}

const asArray = (r: any) => (Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : []);

export function useAssets() {
  const { base, eid } = useEngagement();
  return useQuery({ queryKey: ['assets', eid, 'options'], queryFn: async () => asArray(await api.get(`${base}/assets`)) as { id: string; code: string; ip: string | null; hostname: string }[], enabled: !!eid });
}
export function useServices() {
  const { base, eid } = useEngagement();
  return useQuery({
    queryKey: ['services', eid, 'options'],
    queryFn: async () => asArray(await api.get(`${base}/services`)) as { id: string; asset_id: string; asset_code: string; ip: string | null; port: number; protocol: string; state: string; service_name: string | null; product: string | null; version: string | null }[],
    enabled: !!eid,
  });
}

/** A finding is "documented" for Lab 4 when it has asset, description, severity, evidence, impact, remediation. */
export function isDocumented(f: FindingRow) {
  return f.validation_status !== 'false_positive' && !!f.description?.trim() && !!f.impact?.trim() && !!f.remediation?.trim() && f.assets.length > 0 && f.evidence.some((e) => e.status === 'active');
}

export function factorTotal(f: Partial<FindingRow>): { total: number; filled: number } {
  let total = 0, filled = 0;
  for (const x of FACTORS) {
    const v = f[x.key] as number | null | undefined;
    if (typeof v === 'number') { total += v; filled++; }
  }
  return { total, filled };
}
