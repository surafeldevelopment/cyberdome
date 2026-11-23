import { CheckCircle2, HelpCircle, Search } from 'lucide-react';
import { Badge } from '../../components/ui';
import { StatusPill } from '../../components/kit';

export interface ScopeResult {
  status: 'in_scope' | 'excluded' | 'not_in_scope' | 'no_scope_defined';
  confirmed: boolean;
  matched?: { id: string; target: string; kind: string };
}

export interface Asset {
  id: string;
  code: string;
  ip: string | null;
  hostname: string;
  hostnames: string[];
  mac: string | null;
  os_name: string | null;
  os_accuracy: number | null;
  os_source: 'detected' | 'analyst' | 'unknown';
  criticality: 'unknown' | 'low' | 'medium' | 'high' | 'critical';
  role: string;
  notes: string;
  host_state: string;
  origin: 'import' | 'manual';
  first_seen: string | null;
  last_seen: string | null;
  open_services: number;
  total_services: number;
  findings: number;
  evidence_count: number;
  scope: ScopeResult;
}

export interface Service {
  id: string;
  asset_id: string;
  asset_code: string;
  ip: string | null;
  hostname: string;
  criticality: string;
  port: number;
  protocol: string;
  state: string;
  service_name: string | null;
  product: string | null;
  version: string | null;
  extra_info: string | null;
  version_status: 'detected' | 'inferred' | 'unknown';
  first_seen: string | null;
  last_seen: string | null;
  observation_count: number;
  last_scan_code: string | null;
  last_scan_import_id: string | null;
  normal_purpose: string;
  analyst_notes: string;
  needs_investigation: number;
  investigation_reason: string;
  findings: number;
}

export interface Observation {
  id: string;
  asset_id: string;
  asset_code?: string;
  scan_import_id: string;
  scan_code?: string;
  evidence_id: string | null;
  evidence_code?: string | null;
  evidence_status?: string | null;
  ip_observed: string | null;
  hostname_observed: string | null;
  port: number;
  protocol: string;
  state: string;
  reason: string | null;
  service_name: string | null;
  product: string | null;
  version: string | null;
  extra_info: string | null;
  version_status: 'detected' | 'inferred' | 'unknown';
  service_method: string | null;
  service_conf: number | null;
  os_observation: string | null;
  observed_at: string | null;
  created_at: string;
}

export interface ScanImport {
  id: string;
  code: string;
  evidence_id: string | null;
  evidence_code: string | null;
  evidence_status?: string | null;
  original_filename: string | null;
  sha256: string | null;
  format: string;
  tool: string;
  tool_version: string | null;
  command_line: string | null;
  scan_started_at: string | null;
  scan_finished_at: string | null;
  status: 'complete' | 'partial' | 'failed' | 'stored_only';
  hosts_total: number;
  hosts_up: number;
  observations_count: number;
  new_assets: number;
  new_services: number;
  updated_services: number;
  unchanged_services: number;
  duplicate_of_code: string | null;
  warnings: string[];
  errors: { row?: number; message: string }[];
  created_by: string | null;
  created_at: string;
  source_category?: string;
}

export function VersionBadge({ status }: { status: string }) {
  if (status === 'detected') return <Badge tone="ok" icon={<CheckCircle2 />} title="Version reported by an active service probe">Detected</Badge>;
  if (status === 'inferred') return <Badge tone="warn" icon={<HelpCircle />} title="Version supplied without probe confirmation">Inferred</Badge>;
  return <Badge tone="muted" icon={<HelpCircle />} title="No version was detected">Unknown</Badge>;
}

export function ScopeBadge({ scope }: { scope: ScopeResult }) {
  const t = scope.matched?.target ? ` (${scope.matched.target})` : '';
  const wrap = (tone: 'ok' | 'bad' | 'warn' | 'info' | 'muted', label: string, title: string) => (
    <span title={title}><StatusPill tone={tone}>{label}</StatusPill></span>
  );
  if (scope.status === 'in_scope')
    return wrap('ok', 'In scope', `Matches authorized target${t}`);
  if (scope.status === 'excluded') return wrap('bad', 'Excluded', `Matches excluded target${t}`);
  if (scope.status === 'not_in_scope') return wrap('warn', 'Not in scope', 'Not covered by any authorized target');
  return wrap('muted', 'Scope undefined', 'No authorized targets are defined yet');
}

export function PortState({ state }: { state: string }) {
  if (state === 'open') return <StatusPill tone="ok">Open</StatusPill>;
  if (state === 'closed') return <StatusPill tone="bad">Closed</StatusPill>;
  if (state.includes('filtered')) return <StatusPill tone="warn">{state[0].toUpperCase() + state.slice(1)}</StatusPill>;
  return <StatusPill tone="muted">{state}</StatusPill>;
}

export function ImportStatus({ status }: { status: string }) {
  const map: Record<string, [string, 'ok' | 'warn' | 'bad' | 'muted']> = {
    complete: ['Complete', 'ok'],
    partial: ['Partial (row errors)', 'warn'],
    failed: ['Failed', 'bad'],
    stored_only: ['Stored only', 'muted'],
  };
  const [label, tone] = map[status] ?? [status, 'muted'];
  return <StatusPill tone={tone}>{label}</StatusPill>;
}

/** Pill search input with a leading icon (reference "Search identities" field). */
export function SearchField({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <div className="search-box filter-search">
      <Search aria-hidden />
      <input type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
    </div>
  );
}

export const svcLabel = (s: { service_name: string | null; product: string | null; version: string | null }) =>
  [s.product, s.version].filter(Boolean).join(' ') || '—';

export const osSourceLabel: Record<string, string> = { detected: 'Detected by scanner', analyst: 'Analyst-entered', unknown: 'Unknown' };
