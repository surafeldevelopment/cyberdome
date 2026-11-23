import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Zap, Users, FileSignature, Radar, Network, ShieldAlert, Activity, Bot, Archive, FileText, Settings,
  Search, Upload, Menu, ChevronsLeft, ChevronsRight, FlaskConical, ChevronDown, ChevronsUpDown, Eye,
} from 'lucide-react';
import { api, qs, PREVIEW } from '../lib/api';
import { useEngagement } from '../lib/engagement';
import type { StatusInfo } from '../lib/types';

const NAV: { group: string; items: { to: string; label: string; icon: any; lab?: string; end?: boolean }[] }[] = [
  {
    group: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/autopilot', label: 'Autopilot', icon: Zap },
    ],
  },
  {
    group: 'Assessment',
    items: [
      { to: '/engagement', label: 'Engagement', icon: FileSignature, lab: 'L1' },
      { to: '/recon', label: 'Recon', icon: Radar, lab: 'L2' },
      { to: '/scan', label: 'Scan & Enumeration', icon: Network, lab: 'L3' },
      { to: '/vulnerabilities', label: 'Vulnerabilities', icon: ShieldAlert, lab: 'L4' },
      { to: '/attack', label: 'Attack Evidence', icon: Activity, lab: 'L5' },
      { to: '/ai', label: 'AI Security Analyst', icon: Bot, lab: 'L6' },
    ],
  },
  {
    group: 'Records',
    items: [
      { to: '/evidence', label: 'Evidence Locker', icon: Archive },
      { to: '/reports', label: 'Reports', icon: FileText },
      { to: '/team', label: 'Team', icon: Users },
    ],
  },
];

const IMPORTS = [
  { to: '/evidence?upload=1', label: 'Evidence file or reference', hint: 'Screenshots, outputs, logs, PCAPs' },
  { to: '/scan?tab=import', label: 'Scan results', hint: 'Nmap XML, CSV, JSON' },
  { to: '/vulnerabilities?tab=imports', label: 'Vulnerability report', hint: 'Normalized CSV/JSON, Nessus, Greenbone' },
  { to: '/attack?tab=imports', label: 'Logs or packet export', hint: 'CSV, JSON Lines, tshark exports' },
  { to: '/recon?import=1', label: 'Recon observations', hint: 'CSV or JSON' },
];

function Brand() {
  return (
    <Link to="/" className="brand">
      <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden>
        <rect x="0.5" y="0.5" width="39" height="39" rx="11" fill="#0f1411" stroke="#24603f" />
        <path d="M10 26a10 10 0 0 1 20 0" fill="none" stroke="#3dcc7e" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M14.5 26a5.5 5.5 0 0 1 11 0" fill="none" stroke="#3dcc7e" strokeWidth="2.6" strokeLinecap="round" opacity=".55" />
        <circle cx="20" cy="26" r="2.3" fill="#7fe0a6" />
      </svg>
      <span className="brand-text">
        <strong>CyberDome</strong>
        <span>Command Center</span>
      </span>
    </Link>
  );
}

/** Self-declared local analyst identity (no login). Links to Settings. */
function Profile() {
  const { base, eid } = useEngagement();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Record<string, string>>('/api/settings') });
  const eng = useQuery({ queryKey: ['engagement', eid], queryFn: () => api.get<any>(base), enabled: !!eid });
  const name = settings.data?.analyst_name?.trim() || 'Local analyst';
  const member = eng.data?.team?.find((m: any) => m.name.trim().toLowerCase() === name.toLowerCase());
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <Link to="/settings" className="profile" title="Analyst identity (self-declared, set in Settings)">
      <span className="avatar" aria-hidden>{initials}</span>
      <span className="profile-text">
        <strong>{name}</strong>
        <span>{member?.role || (settings.data?.analyst_name ? 'Analyst · local session' : 'Set your name in Settings')}</span>
      </span>
      <ChevronsUpDown size={16} aria-hidden />
    </Link>
  );
}

function DueCard() {
  const today = new Date();
  const due = new Date('2026-11-23T23:59:00');
  const days = Math.ceil((due.getTime() - today.getTime()) / 86400000);
  return (
    <Link to="/tracker" className="nav-due" aria-label={`Final submission ${days >= 0 ? `in ${days} days` : 'date passed'}. Open the project tracker.`}>
      <span className="due-text">
        <span className="due-line">{days > 0 ? `Final due in ${days} days` : days === 0 ? 'Final due today' : 'Final due date passed'}</span>
        <span className="due-cta">Open Tracker</span>
      </span>
    </Link>
  );
}

function StatusPills() {
  const q = useQuery({ queryKey: ['status'], queryFn: () => api.get<StatusInfo>('/api/status'), refetchInterval: 30000, retry: 0 });
  const nav = useNavigate();
  if (q.isError)
    return (
      <div className="conn">
        <button className="conn-pill" onClick={() => q.refetch()} title="The server did not respond. Click to retry.">
          <span className="dot bad" /> <span className="lbl">Server</span> offline
        </button>
      </div>
    );
  const s = q.data;
  const ai = s?.ai.state;
  const refsOk = s?.references.online;
  return (
    <div className="conn" aria-label="Connection status">
      <button className="conn-pill" onClick={() => nav('/settings')} title={s ? `Database: ${s.database.state}, schema v${s.database.schemaVersion}` : 'Checking database'}>
        <span className={`dot ${s?.database.state === 'connected' ? 'ok' : s ? 'bad' : 'off'}`} /> <span className="lbl">Database</span>
      </button>
      <button className="conn-pill" onClick={() => nav('/settings')} title={s?.ai.message ?? (s ? `AI: ${s.ai.provider} · ${s.ai.model}` : 'Checking AI provider')}>
        <span className={`dot ${ai === 'configured' ? 'ok' : ai === 'misconfigured' ? 'bad' : 'off'}`} />
        <span className="lbl">AI</span> {ai === 'configured' ? '' : ai === 'misconfigured' ? 'error' : 'off'}
      </button>
      <button className="conn-pill" onClick={() => nav('/settings')} title={refsOk ? 'External reference lookups enabled (results show their own retrieval status)' : 'External reference lookups disabled'}>
        <span className={`dot ${refsOk ? 'ok' : 'off'}`} /> <span className="lbl">References</span>
      </button>
    </div>
  );
}

function GlobalSearch() {
  const { base, eid } = useEngagement();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const res = useQuery({
    queryKey: ['search', eid, q],
    queryFn: () => api.get<{ results: any[] }>(`${base}/search${qs({ q })}`),
    enabled: !!eid && q.trim().length >= 2,
  });
  const results = res.data?.results ?? [];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    const onClick = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, []);
  const go = (r: any) => {
    nav(r.route);
    setOpen(false);
    setQ('');
  };
  return (
    <div className="search-box" ref={ref}>
      <Search aria-hidden />
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-expanded={open && q.length >= 2}
        aria-controls="global-search-results"
        aria-label="Search all records in this engagement"
        placeholder="Search evidence, hosts, findings, events…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === 'Enter' && results[active]) go(results[active]);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      <kbd>Ctrl K</kbd>
      {open && q.trim().length >= 2 && (
        <div className="search-results" id="global-search-results" role="listbox">
          {res.isLoading && <div className="muted small" style={{ padding: 8 }}>Searching…</div>}
          {!res.isLoading && !results.length && <div className="muted small" style={{ padding: 8 }}>No records match “{q}”.</div>}
          {results.map((r, i) => (
            <a
              key={`${r.type}-${r.id}`}
              href={r.route}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onClick={(e) => { e.preventDefault(); go(r); }}
            >
              <span className="rtype">{r.type}</span>
              <span style={{ minWidth: 0 }}>
                <span className="mono" style={{ color: 'var(--accent-strong)', marginRight: 8 }}>{r.code}</span>
                <span className="clip" style={{ display: 'inline-block', maxWidth: '100%', verticalAlign: 'bottom' }}>{r.label}</span>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function ImportMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  useEffect(() => {
    const onClick = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn primary import-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Upload /> <span>Import</span> <ChevronDown />
      </button>
      {open && (
        <div className="search-results" role="menu" style={{ left: 'auto', right: 0, width: 300 }}>
          {IMPORTS.map((i) => (
            <a key={i.to} href={i.to} role="menuitem" style={{ display: 'block' }} onClick={(e) => { e.preventDefault(); setOpen(false); nav(i.to); }}>
              <div>{i.label}</div>
              <div className="tiny faint">{i.hint}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { current, isDemo } = useEngagement();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('cyberdome.nav') === 'collapsed'; } catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setMobileOpen(false), [loc.pathname]);
  const toggle = () => {
    setCollapsed((c) => {
      try { localStorage.setItem('cyberdome.nav', c ? 'open' : 'collapsed'); } catch { /* ignore */ }
      return !c;
    });
  };
  return (
    <div className={`shell ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      <a href="#main-content" className="skip-link">Skip to content</a>
      <nav className="nav" aria-label="Primary">
        <Brand />
        <Profile />
        <div className="nav-sep" aria-hidden />
        {NAV.map((g) => (
          <div className="nav-group" key={g.group} role="group" aria-label={g.group}>
            {g.items.map((it) => (
              <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title={collapsed ? it.label : undefined}>
                <it.icon aria-hidden />
                <span className="nav-label">{it.label}</span>
                {it.lab && <span className="nav-lab">{it.lab}</span>}
              </NavLink>
            ))}
          </div>
        ))}
        <div className="nav-spacer" />
        <div className="nav-group">
          <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title={collapsed ? 'Setting' : undefined}>
            <Settings aria-hidden />
            <span className="nav-label">Settings</span>
          </NavLink>
          <button className="nav-collapse" onClick={toggle} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}>
            {collapsed ? <ChevronsRight size={19} /> : <ChevronsLeft size={19} />}
            <span>Collapse</span>
          </button>
        </div>
        <div className="nav-sep" aria-hidden style={{ margin: '16px 8px 0' }} />
        <DueCard />
      </nav>
      {mobileOpen && <div className="overlay" style={{ zIndex: 65 }} onClick={() => setMobileOpen(false)} />}
      <div className="main">
        <div className="frame">
          <header className="topbar">
            <button className="btn ghost icon menu-btn" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
              <Menu />
            </button>
            <GlobalSearch />
            <div className="topbar-right">
              <StatusPills />
              <ImportMenu />
            </div>
          </header>
          {PREVIEW && (
            <div className="unauth-band" role="note" style={{ borderColor: 'var(--accent-line)', background: 'var(--accent-deep)' }}>
              <Eye aria-hidden style={{ color: 'var(--accent-strong)' }} />
              Read-only preview: a snapshot of this app's real API responses, captured {(window as any).__CYBERDOME_PREVIEW__?.captured_at ? new Date((window as any).__CYBERDOME_PREVIEW__.captured_at).toLocaleString() : ''}. Imports and edits are disabled here. Run CyberDome locally to use them.
            </div>
          )}
          {isDemo && (
            <div className="demo-band" role="note">
              <FlaskConical aria-hidden />
              Demo Data: this engagement contains clearly labeled synthetic records for demonstrating the interface. They are not assessment results.
            </div>
          )}
          <main className="content" id="main-content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
