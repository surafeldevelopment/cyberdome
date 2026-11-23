import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, Info, XCircle, HelpCircle, Inbox, Bot, Globe, Calculator, Download, UserCheck, FlaskConical, PenLine,
  Octagon, ChevronsUp, ChevronUp, Minus, Circle,
} from 'lucide-react';
import type { Severity } from '../lib/types';
import { humanize, SOURCE_LABEL } from '../lib/format';
import { useEngagement } from '../lib/engagement';

/* ---------- Page header ---------- */
/** "Engagement / <name> ⌄" switcher shown next to top-level page titles. */
export function EngagementCrumb() {
  const { engagements, current, setEngagement } = useEngagement();
  return (
    <span className="view-crumb">
      <label htmlFor="eng-crumb">Engagement</label>
      <span aria-hidden>/</span>
      <select id="eng-crumb" value={current?.id ?? ''} onChange={(e) => setEngagement(e.target.value)}>
        {engagements.map((e) => (
          <option key={e.id} value={e.id}>
            {e.is_demo ? '[DEMO] ' : ''}
            {e.name}
          </option>
        ))}
      </select>
    </span>
  );
}

export function PageHeader({ title, subtitle, actions, crumbs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumbs?: { label: string; to?: string }[] }) {
  return (
    <header className="page-header">
      <div className="titles">
        {crumbs && (
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={i} className="row" style={{ gap: 6 }}>
                {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
                {i < crumbs.length - 1 && <span aria-hidden>/</span>}
              </span>
            ))}
          </nav>
        )}
        <div className="title-row">
          <h1>{title}</h1>
          {!crumbs && <EngagementCrumb />}
        </div>
        {subtitle && <div className="subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/* ---------- Panel ---------- */
export function Panel({ title, hint, actions, children, flush, className = '', id }: { title?: ReactNode; hint?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; className?: string; id?: string }) {
  return (
    <section className={`panel ${className}`} id={id} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || actions) && (
        <div className="panel-head">
          {title && <h2>{title}</h2>}
          {hint && <span className="hint">{hint}</span>}
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      <div className={`panel-body ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

/* ---------- Severity (icon + text, never color alone) ---------- */
const SEV_ICON: Record<Severity, any> = { critical: Octagon, high: ChevronsUp, medium: ChevronUp, low: Minus, info: Circle };
export const SEV_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
export function SeverityBadge({ severity }: { severity: Severity | string }) {
  const s = (severity || 'info') as Severity;
  const Icon = SEV_ICON[s] ?? Circle;
  return (
    <span className={`badge sev sev-${s}`}>
      <Icon aria-hidden />
      {s === 'info' ? 'Info' : s[0].toUpperCase() + s.slice(1)}
    </span>
  );
}

type Tone = 'ok' | 'warn' | 'bad' | 'accent' | 'ai' | 'ext' | 'demo' | 'muted' | undefined;
export function Badge({ tone, children, icon, title }: { tone?: Tone; children: ReactNode; icon?: ReactNode; title?: string }) {
  return (
    <span className={`badge ${tone ? `tone-${tone}` : ''}`} title={title}>
      {icon}
      {children}
    </span>
  );
}

const VALIDATION: Record<string, [string, Tone]> = {
  scanner_reported: ['Scanner-reported', 'warn'],
  potential: ['Potential (verify)', 'warn'],
  validated: ['Analyst-validated', 'ok'],
  false_positive: ['False positive', 'muted'],
};
export function ValidationBadge({ value }: { value: string }) {
  const [label, tone] = VALIDATION[value] ?? [humanize(value), undefined];
  return <Badge tone={tone} icon={value === 'validated' ? <CheckCircle2 /> : value === 'false_positive' ? <XCircle /> : <HelpCircle />}>{label}</Badge>;
}

const CONF: Record<string, [string, Tone]> = {
  high: ['High confidence', 'ok'],
  medium: ['Medium confidence', 'accent'],
  low: ['Low confidence', 'warn'],
  requires_more_evidence: ['Requires more evidence', 'warn'],
  unrated: ['Confidence not rated', 'muted'],
};
export function ConfidenceBadge({ value }: { value: string }) {
  const [label, tone] = CONF[value] ?? [humanize(value), undefined];
  return <Badge tone={tone}>{label}</Badge>;
}

const SANI: Record<string, [string, Tone]> = {
  not_reviewed: ['Needs review', 'warn'],
  sanitized: ['Sanitized', 'ok'],
  no_sensitive_data: ['No sensitive data', 'ok'],
  contains_sensitive: ['Contains sensitive data', 'bad'],
};
export function SanitizationBadge({ value }: { value: string }) {
  const [label, tone] = SANI[value] ?? [humanize(value), undefined];
  return <Badge tone={tone}>{label}</Badge>;
}

export function SourceBadge({ value }: { value: string }) {
  const tone: Tone = value === 'demo' ? 'demo' : value === 'external_reference' ? 'ext' : value === 'project_artifact' ? 'muted' : 'accent';
  return <Badge tone={tone}>{SOURCE_LABEL[value] ?? humanize(value)}</Badge>;
}

/** Provenance marker: where a value came from. */
export type ProvenanceKind = 'imported' | 'entered' | 'calculated' | 'external' | 'ai' | 'verified' | 'demo';
const PROV: Record<ProvenanceKind, [string, any]> = {
  imported: ['Imported', Download],
  entered: ['Analyst-entered', PenLine],
  calculated: ['Calculated', Calculator],
  external: ['External reference', Globe],
  ai: ['AI-generated', Bot],
  verified: ['Human-verified', UserCheck],
  demo: ['Demo data', FlaskConical],
};
export function Provenance({ kind, detail }: { kind: ProvenanceKind; detail?: string }) {
  const [label, Icon] = PROV[kind];
  return (
    <span className={`prov ${kind}`} title={detail ?? label}>
      <Icon aria-hidden />
      {label}
    </span>
  );
}

/* ---------- States ---------- */
export function EmptyState({ icon, title, children, actions }: { icon?: ReactNode; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon">{icon ?? <Inbox />}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'bad' | 'ok' | 'ai'; title?: ReactNode; children?: ReactNode }) {
  const Icon = tone === 'warn' ? AlertTriangle : tone === 'bad' ? XCircle : tone === 'ok' ? CheckCircle2 : tone === 'ai' ? Bot : Info;
  return (
    <div className={`notice ${tone}`} role={tone === 'bad' ? 'alert' : undefined}>
      <Icon aria-hidden />
      <div>
        {title && <strong>{title} </strong>}
        {children}
      </div>
    </div>
  );
}

export function Loading({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="stack tight" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 18, width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  const disconnected = /reach the CyberDome server/i.test(msg);
  return (
    <Notice tone="bad" title={disconnected ? 'Disconnected.' : 'Could not load this data.'}>
      {msg}{' '}
      {retry && (
        <button className="btn sm" onClick={retry} style={{ marginLeft: 8 }}>
          Retry
        </button>
      )}
    </Notice>
  );
}

/* ---------- Tabs synced with ?tab= ---------- */
export function useTab(defaultTab: string): [string, (t: string) => void] {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? defaultTab;
  const set = (t: string) => {
    const p = new URLSearchParams(params);
    if (t === defaultTab) p.delete('tab');
    else p.set('tab', t);
    for (const k of ['focus']) p.delete(k);
    setParams(p, { replace: true });
  };
  return [tab, set];
}

export function Tabs({ tabs, value, onChange, label }: { tabs: { id: string; label: ReactNode; count?: number }[]; value: string; onChange: (id: string) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => (refs.current[i] = el)}
          role="tab"
          aria-selected={value === t.id}
          tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
              refs.current[n]?.focus();
              onChange(tabs[n].id);
            }
          }}
        >
          {t.label}
          {t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- Form fields ---------- */
export function Field({ label, help, error, children, full, htmlFor }: { label: ReactNode; help?: ReactNode; error?: string; children: ReactNode; full?: boolean; htmlFor?: string }) {
  return (
    <div className={`field ${full ? 'full' : ''}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {help && <span className="help">{help}</span>}
      {error && <span className="err">{error}</span>}
    </div>
  );
}

export function Select({ value, onChange, options, id, ariaLabel, placeholder }: { value: string; onChange: (v: string) => void; options: (string | { value: string; label: string })[]; id?: string; ariaLabel?: string; placeholder?: string }) {
  return (
    <select id={id} aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{humanize(o)}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );
}

/** Small "How is this calculated?" popover. */
export function HowCalculated({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <span ref={ref} style={{ position: 'relative' }}>
      <button
        className="btn ghost icon sm how-btn"
        aria-label="How is this calculated?"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <Calculator />
      </button>
      {open && (
        <span className="popover" role="tooltip" style={{ right: 0, top: 30 }}>
          {text}
        </span>
      )}
    </span>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="mono">{children}</span>;
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
