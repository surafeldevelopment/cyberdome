import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import type { AssetBrief, Confidence, Sanitization, SourceCategory, StatusInfo } from '../../lib/types';
import { Field, Select } from '../../components/ui';
import { SOURCE_LABEL } from '../../lib/format';

export const SOURCE_OPTIONS: { value: SourceCategory; label: string }[] = [
  { value: 'authorized_lab', label: SOURCE_LABEL.authorized_lab },
  { value: 'instructor_supplied', label: SOURCE_LABEL.instructor_supplied },
  { value: 'external_reference', label: SOURCE_LABEL.external_reference },
  { value: 'project_artifact', label: SOURCE_LABEL.project_artifact },
];
export const SOURCE_HELP: Record<string, string> = {
  authorized_lab: 'Actual results from instructor-approved lab activity (your scans, commands, captures).',
  instructor_supplied: 'Files or datasets your instructor provided for the assignment.',
  external_reference: 'Advisories, CVE pages, ATT&CK definitions. Enrichment, not proof about a lab asset.',
  project_artifact: 'Captures of this application itself (e.g. required page screenshots).',
  demo: 'Clearly labeled synthetic records, only allowed in the demo engagement.',
};
export const CONF_OPTIONS: { value: Confidence; label: string }[] = [
  { value: 'unrated', label: 'Not rated' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'requires_more_evidence', label: 'Requires more evidence' },
];
export const SANI_OPTIONS: { value: Sanitization; label: string }[] = [
  { value: 'not_reviewed', label: 'Not reviewed yet' },
  { value: 'sanitized', label: 'Sanitized (sensitive values removed)' },
  { value: 'no_sensitive_data', label: 'Reviewed: no sensitive data' },
  { value: 'contains_sensitive', label: 'Contains sensitive data' },
];
export const TYPE_OPTIONS = ['png', 'jpeg', 'gif', 'webp', 'pdf', 'pcap', 'pcapng', 'nmap_xml', 'nessus_xml', 'greenbone_xml', 'xml', 'json', 'csv', 'text', 'html', 'svg', 'zip', 'gzip', 'binary'];

export interface MetaState {
  title: string;
  source_category: SourceCategory;
  source_tool: string;
  collected_at: string; // datetime-local value
  collected_at_note: string;
  observation: string;
  interpretation: string;
  confidence: Confidence;
  tags: string;
  sanitization_status: Sanitization;
  asset_ids: string[];
}

export const emptyMeta = (isDemo: boolean): MetaState => ({
  title: '',
  source_category: isDemo ? 'demo' : 'authorized_lab',
  source_tool: '',
  collected_at: '',
  collected_at_note: '',
  observation: '',
  interpretation: '',
  confidence: 'unrated',
  tags: '',
  sanitization_status: 'not_reviewed',
  asset_ids: [],
});

/** Assets for linking. The assets endpoint returns an array or {items}; a 404 means none yet. */
export function useAssetOptions() {
  const { base, eid } = useEngagement();
  return useQuery({
    queryKey: ['assets', eid, 'options'],
    queryFn: async () => {
      try {
        const r = await api.get<any>(`${base}/assets`);
        return (Array.isArray(r) ? r : (r?.items ?? [])) as AssetBrief[];
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return [] as AssetBrief[];
        throw e;
      }
    },
    enabled: !!eid,
  });
}

export function useStatus() {
  return useQuery({ queryKey: ['status'], queryFn: () => api.get<StatusInfo>('/api/status'), staleTime: 30000 });
}

export function AssetMultiSelect({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const q = useAssetOptions();
  const [filter, setFilter] = useState('');
  const assets = q.data ?? [];
  const shown = useMemo(
    () => assets.filter((a) => !filter || `${a.code} ${a.ip ?? ''} ${a.hostname}`.toLowerCase().includes(filter.toLowerCase())),
    [assets, filter],
  );
  return (
    <div className="field full">
      <span className="label">Associated assets</span>
      {q.isLoading ? (
        <span className="help">Loading assets…</span>
      ) : q.isError ? (
        <span className="err">Assets could not be loaded.</span>
      ) : !assets.length ? (
        <span className="help">
          No assets recorded yet. Assets are created by <Link to="/scan?tab=import">scan imports</Link>; you can link them later.
        </span>
      ) : (
        <div className="ev-asset-box">
          {assets.length > 8 && (
            <input type="search" placeholder="Filter assets" aria-label="Filter assets" value={filter} onChange={(e) => setFilter(e.target.value)} />
          )}
          <div className="ev-asset-list">
            {shown.map((a) => (
              <label key={a.id} className="check">
                <input
                  type="checkbox"
                  checked={value.includes(a.id)}
                  onChange={() => onChange(value.includes(a.id) ? value.filter((v) => v !== a.id) : [...value, a.id])}
                />
                <span className="mono">{a.code}</span>
                <span className="mono">{a.ip ?? '—'}</span>
                {a.hostname && <span className="faint">{a.hostname}</span>}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Shared metadata fields used by the add drawer and the edit drawer. */
export function MetadataFields({ m, set, isDemo, lockSource }: { m: MetaState; set: (p: Partial<MetaState>) => void; isDemo: boolean; lockSource?: boolean }) {
  return (
    <div className="form-grid">
      <Field label="Title" full htmlFor="ev-title" help="Leave blank to use the file name.">
        <input id="ev-title" type="text" value={m.title} onChange={(e) => set({ title: e.target.value })} maxLength={300} />
      </Field>
      <Field
        label="Source category"
        htmlFor="ev-source"
        help={lockSource ? 'Source category is fixed after import.' : SOURCE_HELP[m.source_category]}
      >
        {isDemo ? (
          <select id="ev-source" value="demo" disabled>
            <option value="demo">Demo data (demo engagement)</option>
          </select>
        ) : (
          <select id="ev-source" value={m.source_category} disabled={lockSource} onChange={(e) => set({ source_category: e.target.value as SourceCategory })}>
            {(lockSource ? [...SOURCE_OPTIONS, { value: 'demo', label: SOURCE_LABEL.demo }] : SOURCE_OPTIONS).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Source / tool" htmlFor="ev-tool" help="e.g. Nmap 7.94, Wireshark, Windows CMD, Event Viewer, screenshot">
        <input id="ev-tool" type="text" value={m.source_tool} onChange={(e) => set({ source_tool: e.target.value })} maxLength={200} />
      </Field>
      <Field label="Collected at" htmlFor="ev-collected" help="When the evidence was collected or observed (your local time).">
        <input id="ev-collected" type="datetime-local" value={m.collected_at} onChange={(e) => set({ collected_at: e.target.value })} />
      </Field>
      <Field label="Collection time note" htmlFor="ev-collected-note" help={m.collected_at ? 'Optional context, e.g. timezone of the source system.' : 'Explain why the collection time is unknown, if it is.'}>
        <input id="ev-collected-note" type="text" value={m.collected_at_note} onChange={(e) => set({ collected_at_note: e.target.value })} maxLength={500} />
      </Field>
      <Field label="Observation: what the evidence actually shows" full htmlFor="ev-obs">
        <textarea id="ev-obs" value={m.observation} onChange={(e) => set({ observation: e.target.value })} maxLength={20000} />
      </Field>
      <Field label="Interpretation: what the team believes it means" full htmlFor="ev-int">
        <textarea id="ev-int" value={m.interpretation} onChange={(e) => set({ interpretation: e.target.value })} maxLength={20000} />
      </Field>
      <Field label="Confidence" htmlFor="ev-conf">
        <Select id="ev-conf" value={m.confidence} onChange={(v) => set({ confidence: v as Confidence })} options={CONF_OPTIONS} />
      </Field>
      <Field label="Sanitization status" htmlFor="ev-san" help="Only sanitized or no-sensitive-data evidence can be sent to the AI analyst.">
        <Select id="ev-san" value={m.sanitization_status} onChange={(v) => set({ sanitization_status: v as Sanitization })} options={SANI_OPTIONS} />
      </Field>
      <Field label="Tags" full htmlFor="ev-tags" help="Comma-separated, e.g. lab3, nmap, server01">
        <input id="ev-tags" type="text" value={m.tags} onChange={(e) => set({ tags: e.target.value })} />
      </Field>
      <AssetMultiSelect value={m.asset_ids} onChange={(ids) => set({ asset_ids: ids })} />
    </div>
  );
}

export function shortHash(h: string | null | undefined) {
  return h ? `${h.slice(0, 8)}…${h.slice(-4)}` : '—';
}

export const HASH_CAVEAT =
  'A matching SHA-256 shows the stored bytes have not changed since import. It does not by itself prove the evidence is authentic or establish a complete chain of custody.';
