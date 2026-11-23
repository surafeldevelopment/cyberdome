import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, CircleDashed, BadgeCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { StatusPill } from '../../components/kit';

export interface Requirement { id: string; label: string; met: boolean; detail: string; link?: string }
export interface LabStatus {
  lab: string;
  title: string;
  status: 'not_started' | 'in_progress' | 'requirements_met' | 'signed_off';
  requirements: Requirement[];
  met: number;
  total: number;
  signoff: { signed_off_by: string; signed_off_at: string; notes: string } | null;
}
export interface ScreenshotReq {
  id: string; lab: string; key: string; label: string; capture_kind: 'app_view' | 'tool_activity'; app_route: string | null;
  evidence_id: string | null; evidence_code: string | null; evidence_title: string | null; evidence_status: string | null; detected_type: string | null;
}
export interface Deliverable { id: string; key: string; label: string; status: 'not_started' | 'in_progress' | 'done'; notes: string; evidence_id: string | null; evidence_code: string | null; updated_by: string | null; updated_at: string }
export interface TrackerData {
  labs: LabStatus[];
  screenshots: ScreenshotReq[];
  deliverables: Deliverable[];
  checkpoints: { key: string; date: string; label: string; check: string }[];
  final_due: string;
  today: string;
}

export function useTracker() {
  const { base, eid } = useEngagement();
  return useQuery({ queryKey: ['tracker', eid], queryFn: () => api.get<TrackerData>(`${base}/tracker`), enabled: !!eid });
}

export const LAB_STATUS: Record<LabStatus['status'], { label: string; tone: 'ok' | 'info' | 'muted'; icon: any }> = {
  signed_off: { label: 'Signed off', tone: 'ok', icon: BadgeCheck },
  requirements_met: { label: 'Requirements met', tone: 'ok', icon: CheckCircle2 },
  in_progress: { label: 'In progress', tone: 'info', icon: CircleDashed },
  not_started: { label: 'Not started', tone: 'muted', icon: Circle },
};

export function LabStatusBadge({ status }: { status: LabStatus['status'] }) {
  const s = LAB_STATUS[status];
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
}

export function RequirementList({ reqs }: { reqs: Requirement[] }) {
  return (
    <div role="list">
      {reqs.map((r) => (
        <div key={r.id} className="req req-stack" role="listitem">
          {r.met ? <CheckCircle2 className="met" aria-label="Met" /> : <Circle className="unmet" aria-label="Not met" />}
          <span className="req-text">
            {r.link ? <Link to={r.link}>{r.label}</Link> : r.label}
            <span className="req-detail">{r.detail}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
