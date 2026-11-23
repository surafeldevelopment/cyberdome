import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';

export const SECTIONS: { key: string; title: string; help: string }[] = [
  { key: 'executive_summary', title: 'Executive summary', help: 'One page for CyberDome management: purpose, overall risk, top risks, key recommendations.' },
  { key: 'methodology', title: 'Methodology', help: 'How the team collected and analyzed evidence: tools, imports, verification approach.' },
  { key: 'limitations', title: 'Limitations', help: 'What was out of scope, what could not be verified, data gaps, and tool limits.' },
  { key: 'recommendations', title: 'Remediation recommendations (introduction)', help: 'Optional narrative shown above the recommendation table built from findings.' },
  { key: 'lessons_learned', title: 'Lessons learned', help: 'What worked, what was difficult, and what you would improve.' },
];

export interface ReadinessIssue { severity: 'blocker' | 'warning'; area: string; message: string; link?: string }
export interface Readiness { ready: boolean; blockers?: number; warnings?: number; issues: ReadinessIssue[] }
export interface ReportResp {
  report: { id: string; title: string; status: 'draft' | 'final'; finalized_by: string | null; finalized_at: string | null; updated_at: string };
  narrative: Record<string, string>;
  narrative_sources: Record<string, any>;
  engagement: { name: string; is_demo: boolean };
  readiness: Readiness;
  findings: any[];
  evidence: any[];
  ai: { total: number; verified: number; unverified: number; rejected: number; sections: any[] };
}
export interface RenderResp { kind: string; html: string; title: string; status: string; is_demo: boolean; generated_at: string; readiness: Readiness }

export function useRendered(kind: 'full' | 'executive') {
  const { base, eid } = useEngagement();
  return useQuery({ queryKey: ['report-render', eid, kind], queryFn: () => api.get<RenderResp>(`${base}/report/render${qs({ kind })}`), enabled: !!eid });
}

/**
 * Renders the server-produced report fragment. Every user-supplied value in it was
 * HTML-escaped on the server (services/report/render.ts); no uploaded markup is rendered.
 */
export function ReportDoc({ html }: { html: string }) {
  return <article className="report-doc" dangerouslySetInnerHTML={{ __html: html }} />;
}
