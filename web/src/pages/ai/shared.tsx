import { Bot, CheckCircle2, XCircle, PenLine, AlertTriangle } from 'lucide-react';
import { Badge } from '../../components/ui';
import { StatusPill } from '../../components/kit';

export const TASKS: { key: string; label: string; lab: string | null }[] = [
  { key: 'assessment_summary', label: 'Summarize selected assessment evidence', lab: 'L6' },
  { key: 'top_risks', label: 'Identify the top three supported risks', lab: 'L6' },
  { key: 'explain_nontechnical', label: 'Explain a finding in non-technical language', lab: 'L4' },
  { key: 'next_step', label: 'Recommend a next authorized investigative step', lab: 'L6' },
  { key: 'remediation_priorities', label: 'Draft remediation priorities', lab: 'L6' },
  { key: 'attack_mapping', label: 'Suggest MITRE ATT&CK mappings', lab: 'L6' },
  { key: 'executive_summary', label: 'Draft an executive summary', lab: 'L6' },
  { key: 'recon_summary', label: 'Summarize reconnaissance evidence', lab: 'L2' },
  { key: 'scan_interpretation', label: 'Interpret completed scan results', lab: 'L3' },
  { key: 'timeline_summary', label: 'Summarize the attack timeline', lab: 'L5' },
  { key: 'custom', label: 'Custom evidence-grounded question', lab: null },
];
/** Labels for tasks that are not offered in the evidence-grounded selector. */
const OTHER_TASKS: Record<string, string> = { general_question: 'General question (no evidence sent)' };
export const taskLabel = (k: string) => TASKS.find((t) => t.key === k)?.label ?? OTHER_TASKS[k] ?? k;

export interface AiSessionSummary {
  id: string;
  code: string;
  task_type: string;
  task_label: string;
  question: string;
  provider: string;
  model: string;
  status: 'completed' | 'failed';
  error: string | null;
  review_status: 'unverified' | 'verified' | 'verified_with_edits' | 'rejected';
  evidence_codes: string[];
  citations: Citations;
  created_by: string | null;
  created_at: string;
  reviewed_text?: string | null;
  excerpt?: string;
}
export interface Citations {
  valid?: string[];
  not_in_context?: string[];
  unknown?: string[];
  included?: string[];
  uncited_included?: string[];
  total_mentions?: number;
  note?: string;
}
export interface AiSessionDetail extends AiSessionSummary {
  system_prompt: string;
  user_prompt: string;
  context_sha256: string;
  response_text: string | null;
  usage: Record<string, any>;
  attack_ids: { id: string; status: 'known' | 'unknown' | 'unchecked'; name?: string; tactics?: string }[];
  evidence: { id: string | null; code: string; title: string; status: string; sanitization_status?: string }[];
  reviews: { id: string; reviewer: string; decision: string; notes: string; edited_text: string | null; created_at: string }[];
  reviewed_text: string | null;
  mappings: { id: string; technique_id: string; technique_name: string; target_type: string; status: string }[];
  report_sections: string[];
  citation_note: string;
}

export function ReviewBadge({ s }: { s: Pick<AiSessionSummary, 'status' | 'review_status'> }) {
  if (s.status === 'failed') return <Badge tone="bad" icon={<AlertTriangle />}>Failed request</Badge>;
  if (s.review_status === 'verified') return <Badge tone="ok" icon={<CheckCircle2 />}>Human-verified</Badge>;
  if (s.review_status === 'verified_with_edits') return <Badge tone="ok" icon={<PenLine />}>Verified with edits</Badge>;
  if (s.review_status === 'rejected') return <Badge tone="muted" icon={<XCircle />}>Rejected</Badge>;
  return <Badge tone="ai" icon={<Bot />}>Unverified AI draft</Badge>;
}

/** Reference-style dot pill for review state (text always carries the meaning). */
export function ReviewPill({ s }: { s: Pick<AiSessionSummary, 'status' | 'review_status'> }) {
  if (s.status === 'failed') return <StatusPill tone="bad">Failed</StatusPill>;
  if (s.review_status === 'verified') return <StatusPill tone="ok">Verified</StatusPill>;
  if (s.review_status === 'verified_with_edits') return <StatusPill tone="ok">Verified with edits</StatusPill>;
  if (s.review_status === 'rejected') return <StatusPill tone="bad">Rejected</StatusPill>;
  return <StatusPill tone="warn">Unverified draft</StatusPill>;
}
