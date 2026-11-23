import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, HelpCircle, AlertTriangle, Clock, MoreVertical } from 'lucide-react';
import { api } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import type { Engagement, EvidenceBrief } from '../../lib/types';
import { Badge } from '../../components/ui';
import { StatusPill } from '../../components/kit';

/** Full engagement record (for timezone etc.). */
export function useEngagementDetail() {
  const { base, eid } = useEngagement();
  return useQuery({ queryKey: ['engagement', eid], queryFn: () => api.get<Engagement>(base), enabled: !!eid });
}

export const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
  'Europe/London', 'Europe/Berlin', 'Africa/Addis_Ababa', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney',
];

export function timezoneOptions(current?: string) {
  const list = current && !TIMEZONES.includes(current) ? [current, ...TIMEZONES] : TIMEZONES;
  return list.map((z) => ({ value: z, label: z }));
}

const TS: Record<string, [string, any, string]> = {
  explicit_offset: ['Explicit offset → UTC', 'ok', 'The source timestamp carried a UTC offset or epoch value; converted to UTC.'],
  assumed_timezone: ['Assumed timezone', 'warn', 'The source timestamp had no offset; it was interpreted in the declared source timezone.'],
  missing: ['Time missing', 'muted', 'The source row had no timestamp. It is never placed on the clock.'],
  unparseable: ['Time not placeable', 'bad', 'The timestamp could not be placed on the clock (e.g., relative time or syslog time without a year). The original text is preserved.'],
};
export function TsStatusBadge({ status }: { status: string }) {
  const [label, tone, title] = TS[status] ?? [status, undefined, ''];
  return <Badge tone={tone} title={title} icon={<Clock />}>{label}</Badge>;
}

const ASSESS: Record<string, [string, any, any]> = {
  unassessed: ['Not assessed', 'muted', Circle],
  suspicious: ['Suspicious', 'bad', AlertTriangle],
  benign: ['Benign', 'ok', CheckCircle2],
  requires_more_evidence: ['Requires additional evidence', 'warn', HelpCircle],
};
export function AssessmentBadge({ value }: { value: string }) {
  const [label, tone, Icon] = ASSESS[value] ?? [value, undefined, Circle];
  return <Badge tone={tone} icon={<Icon />}>{label}</Badge>;
}

const VER: Record<string, [string, any, any]> = {
  fact: ['Fact (evidence shows it)', 'ok', CheckCircle2],
  assumption: ['Assumption', 'warn', HelpCircle],
  requires_more_evidence: ['Requires additional evidence', 'warn', AlertTriangle],
};
export function FactBadge({ value }: { value: string }) {
  const [label, tone, Icon] = VER[value] ?? [value, undefined, Circle];
  return <Badge tone={tone} icon={<Icon />}>{label}</Badge>;
}

export const CONFIDENCE_OPTS = [
  { value: 'unrated', label: 'Not rated' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'requires_more_evidence', label: 'Requires more evidence' },
];

export interface Indicator {
  id: string;
  code: string;
  lab: 'lab1' | 'lab5';
  title: string;
  indicator_type: string;
  value: string;
  observation: string;
  why_suspicious: string;
  benign_explanations: string;
  additional_evidence_needed: string;
  confidence: string;
  assessment: string;
  analyst_assessment: string;
  source_host: string;
  dest_host: string;
  observed_at: string | null;
  observed_at_original: string | null;
  evidence: EvidenceBrief[];
  updated_at: string;
}

export interface TimelineEvent {
  id: string;
  code: string;
  original_timestamp: string | null;
  normalized_ts: string | null;
  timezone_note: string;
  time_certainty: 'exact' | 'approximate' | 'unknown';
  order_certainty: 'established' | 'uncertain';
  sequence_hint: number | null;
  source_host: string;
  dest_host: string;
  event_type: string;
  observation: string;
  student_interpretation: string;
  confidence: string;
  verification_status: 'fact' | 'assumption' | 'requires_more_evidence';
  log_event_id: string | null;
  evidence: EvidenceBrief[];
  mappings: { technique_id: string; status: string }[];
  created_at: string;
  updated_at: string;
}

export interface LogEvent {
  id: string;
  log_import_id: string;
  import_code: string;
  evidence_id: string | null;
  evidence_code: string | null;
  evidence_status: string | null;
  row_number: number;
  original_timestamp: string | null;
  normalized_ts: string | null;
  ts_status: string;
  source: string | null;
  destination: string | null;
  src_port: number | null;
  dst_port: number | null;
  protocol: string | null;
  event_type: string | null;
  message: string | null;
  raw: Record<string, unknown>;
  flagged: boolean;
  timeline_code: string | null;
  timeline_id: string | null;
}

export interface LogImport {
  id: string;
  code: string;
  evidence_id: string | null;
  evidence_code: string | null;
  original_filename?: string | null;
  format: string;
  source_timezone: string | null;
  status: string;
  rows_total: number;
  rows_imported: number;
  rows_skipped: number;
  analysis_scope: string;
  warnings: string[];
  errors: { row: number; message: string }[];
  created_at: string;
  ts_summary?: Record<string, number>;
  first_event?: string | null;
  last_event?: string | null;
}

export function ImportStatusBadge({ status }: { status: string }) {
  const tone = status === 'complete' ? 'ok' : status === 'partial' ? 'warn' : 'bad';
  const label = status === 'complete' ? 'Complete' : status === 'partial' ? 'Partial import' : status === 'failed' ? 'Failed' : status;
  return <Badge tone={tone as any}>{label}</Badge>;
}

/** Utility: host[:port] display */
export const hp = (host?: string | null, port?: number | null) => (host ? (port !== null && port !== undefined ? `${host}:${port}` : host) : '—');

/* ---------- Reference-style dot pills (text always carries the meaning) ---------- */
const TS_PILL: Record<string, [string, 'ok' | 'warn' | 'muted']> = {
  explicit_offset: ['Explicit offset', 'ok'],
  assumed_timezone: ['Assumed timezone', 'warn'],
  missing: ['Time missing', 'muted'],
  unparseable: ['Not placeable', 'muted'],
};
export function TsStatusPill({ status }: { status: string }) {
  const [label, tone] = TS_PILL[status] ?? [status, 'muted'];
  return <span title={TS[status]?.[2]}><StatusPill tone={tone}>{label}</StatusPill></span>;
}

const ASSESS_PILL: Record<string, [string, 'bad' | 'warn' | 'ok' | 'muted']> = {
  suspicious: ['Suspicious', 'bad'],
  requires_more_evidence: ['Needs evidence', 'warn'],
  benign: ['Benign', 'ok'],
  unassessed: ['Not assessed', 'muted'],
};
export function AssessmentPill({ value }: { value: string }) {
  const [label, tone] = ASSESS_PILL[value] ?? [value, 'muted'];
  return <span title={value === 'requires_more_evidence' ? 'Requires additional evidence' : undefined}><StatusPill tone={tone}>{label}</StatusPill></span>;
}

export function ImportStatusPill({ status }: { status: string }) {
  const tone = status === 'complete' ? 'ok' : status === 'partial' ? 'warn' : 'bad';
  const label = status === 'complete' ? 'Complete' : status === 'partial' ? 'Partial' : status === 'failed' ? 'Failed' : status;
  return <StatusPill tone={tone}>{label}</StatusPill>;
}

/** Kebab-style row action that runs a callback (e.g. opens a drawer). */
export function KebabButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="kebab" aria-label={label} title={label} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <MoreVertical size={18} />
    </button>
  );
}
