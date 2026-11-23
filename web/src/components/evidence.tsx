import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Paperclip, Plus, Search, UploadCloud, X } from 'lucide-react';
import { api } from '../lib/api';
import { useEngagement } from '../lib/engagement';
import type { Evidence, EvidenceBrief, Paged } from '../lib/types';
import { Modal } from './overlay';
import { SanitizationBadge, SourceBadge } from './ui';
import { fmtBytes } from '../lib/format';

/** Clickable Evidence ID chips. */
export function EvidenceChips({ items, empty = '—' }: { items: (EvidenceBrief | { id: string; code: string; status?: string })[] | undefined; empty?: ReactNode }) {
  if (!items?.length) return <span className="faint">{empty}</span>;
  return (
    <span className="chips">
      {items.map((e) => (
        <Link key={e.id} to={`/evidence/${e.id}`} className={`ev-chip ${e.status === 'withdrawn' ? 'withdrawn' : ''}`} title={'title' in e ? e.title : e.code}>
          {e.code}
        </Link>
      ))}
    </span>
  );
}

/** Hook: all evidence in current engagement (up to 500), for pickers. */
export function useEvidenceOptions(enabled = true) {
  const { base, eid } = useEngagement();
  return useQuery({
    queryKey: ['evidence', eid, 'options'],
    queryFn: () => api.get<Paged<Evidence>>(`${base}/evidence?limit=500&sort=code&dir=asc`),
    enabled: !!eid && enabled,
  });
}

/**
 * Evidence picker: shows selected chips plus a button that opens a searchable selector.
 * `value` holds evidence ids.
 */
export function EvidencePicker({ value, onChange, label = 'Supporting evidence', filter, help }: { value: string[]; onChange: (ids: string[]) => void; label?: string; filter?: (e: Evidence) => boolean; help?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const q = useEvidenceOptions();
  const all = q.data?.items ?? [];
  const selected = all.filter((e) => value.includes(e.id));
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="row" style={{ gap: 6 }}>
        {selected.map((e) => (
          <span key={e.id} className="ev-chip" title={e.title}>
            {e.code}
            <button type="button" aria-label={`Remove ${e.code}`} onClick={() => onChange(value.filter((v) => v !== e.id))} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex' }}>
              <X size={12} />
            </button>
          </span>
        ))}
        <button type="button" className="btn sm" onClick={() => setOpen(true)}>
          <Paperclip /> {selected.length ? 'Change evidence' : 'Link evidence'}
        </button>
      </div>
      {help && <span className="help">{help}</span>}
      <EvidenceSelectModal open={open} onClose={() => setOpen(false)} value={value} onChange={onChange} items={filter ? all.filter(filter) : all} loading={q.isLoading} />
    </div>
  );
}

export function EvidenceSelectModal({ open, onClose, value, onChange, items, loading, title = 'Select evidence' }: { open: boolean; onClose: () => void; value: string[]; onChange: (ids: string[]) => void; items: Evidence[]; loading?: boolean; title?: string }) {
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Set<string>>(new Set(value));
  useEffect(() => {
    if (open) setDraft(new Set(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const filtered = useMemo(
    () => items.filter((e) => !search || `${e.code} ${e.title} ${e.original_filename ?? ''} ${e.source_tool} ${e.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase())),
    [items, search],
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="wide"
      footer={
        <>
          <span className="muted small" style={{ marginRight: 'auto' }}>{draft.size} selected</span>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => { onChange([...draft]); onClose(); }}>Use selection</button>
        </>
      }
    >
      <div className="stack tight">
        <div className="search-box" style={{ maxWidth: 'none' }}>
          <Search />
          <input type="search" placeholder="Filter by ID, title, file name, tool, or tag" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Filter evidence" />
        </div>
        {loading && <p className="muted">Loading evidence…</p>}
        {!loading && !items.length && (
          <p className="muted">
            No eligible evidence yet. <Link to="/evidence?upload=1" onClick={onClose}>Add evidence in the Evidence Locker</Link>.
          </p>
        )}
        <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
          {filtered.map((e) => (
            <label key={e.id} className="row" style={{ padding: '8px 4px', borderBottom: '1px solid var(--line)', cursor: 'pointer', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              <input
                type="checkbox"
                checked={draft.has(e.id)}
                onChange={() => {
                  const d = new Set(draft);
                  d.has(e.id) ? d.delete(e.id) : d.add(e.id);
                  setDraft(d);
                }}
                style={{ marginTop: 3 }}
              />
              <span className="mono" style={{ minWidth: 92, color: 'var(--accent-strong)' }}>{e.code}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span>{e.title}</span>
                <span className="row tiny" style={{ gap: 6, marginTop: 3 }}>
                  <SourceBadge value={e.source_category} />
                  <SanitizationBadge value={e.sanitization_status} />
                  {e.kind === 'file' && <span className="faint">{e.detected_type} · {fmtBytes(e.size_bytes)}</span>}
                  {e.status === 'withdrawn' && <span className="badge tone-muted">Withdrawn</span>}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/** Drag-and-drop file input. */
export function FileDrop({ onFile, accept, label = 'Drop a file here or choose one', file, hint }: { onFile: (f: File | null) => void; accept?: string; label?: string; file?: File | null; hint?: ReactNode }) {
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`dropzone ${drag ? 'drag' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0] ?? null); }}
      onClick={() => input.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      aria-label={label}
    >
      <UploadCloud />
      <div style={{ marginTop: 6 }}>{file ? <strong className="mono">{file.name}</strong> : label}</div>
      {file ? <div className="small faint">{fmtBytes(file.size)} · click to choose a different file</div> : hint && <div className="small faint">{hint}</div>}
      <input ref={input} type="file" hidden accept={accept} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </div>
  );
}

export function AddEvidenceLink() {
  return (
    <Link to="/evidence?upload=1" className="btn sm">
      <Plus /> Add evidence
    </Link>
  );
}
