import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MoreVertical } from 'lucide-react';
import { HowCalculated } from './ui';

/**
 * Reference-style building blocks (gradient KPI cards, icon asset cells, dot status pills,
 * kebab row actions). Every value passed in must come from stored records.
 */
export type PillTone = 'ok' | 'bad' | 'warn' | 'neutral';

export function KpiCard({ icon, label, value, pill, to, calc, onClick }: {
  icon: ReactNode; label: string; value: ReactNode; pill?: { text: string; tone: PillTone } | null; to?: string; calc?: string; onClick?: () => void;
}) {
  const nav = useNavigate();
  const go = onClick ?? (to ? () => nav(to) : undefined);
  return (
    <div
      className="metric"
      role={go ? 'link' : undefined}
      tabIndex={go ? 0 : undefined}
      style={go ? undefined : { cursor: 'default' }}
      aria-label={`${label}: ${typeof value === 'string' || typeof value === 'number' ? value : ''}`}
      onClick={go}
      onKeyDown={go ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), go()) : undefined}
    >
      <span className="m-icon" aria-hidden>{icon}</span>
      <span className="m-label">{label}</span>
      <span className="m-row">
        <span className="m-value">{typeof value === 'number' ? value.toLocaleString() : value}</span>
        {pill && <span className={`delta ${pill.tone}`}>{pill.text}</span>}
      </span>
      {calc && (
        <span className="m-how" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <HowCalculated text={calc} />
        </span>
      )}
    </div>
  );
}

export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="metrics kpi-row">{children}</div>;
}

/** Icon circle + primary line + secondary line (reference "Asset" cell). */
export function AssetCell({ icon, title, sub, to, mono }: { icon: ReactNode; title: ReactNode; sub?: ReactNode; to?: string; mono?: boolean }) {
  const inner = (
    <>
      <span className="ic" aria-hidden>{icon}</span>
      <span className="t">
        <strong className={mono ? 'mono' : undefined}>{title}</strong>
        {sub !== undefined && <span>{sub}</span>}
      </span>
    </>
  );
  return to ? <Link to={to} className="cell-asset">{inner}</Link> : <span className="cell-asset">{inner}</span>;
}

/** Dot status pill (reference Running / Stopped / Pending). Text always carries the meaning. */
export function StatusPill({ tone, children }: { tone: 'ok' | 'bad' | 'warn' | 'info' | 'muted'; children: ReactNode }) {
  return <span className={`pill ${tone}`}><span>{children}</span></span>;
}

/** Kebab-style row action that opens the record. */
export function RowAction({ to, label }: { to: string; label: string }) {
  return (
    <Link className="kebab" to={to} aria-label={label} title={label}>
      <MoreVertical size={18} />
    </Link>
  );
}
