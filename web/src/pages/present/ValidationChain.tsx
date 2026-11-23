import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { EmptyState, Loading, Notice, SeverityBadge, ValidationBadge, Badge } from '../../components/ui';
import { EvidenceChips } from '../../components/evidence';
import { fmtDateTime } from '../../lib/format';

/** Normalizes list responses that may be an array or { items }. */
const items = (d: any): any[] => (Array.isArray(d) ? d : Array.isArray(d?.items) ? d.items : []);

/**
 * "How one finding was validated": finding → affected asset/service → supporting evidence
 * → analyst validation (who/when/notes) → related AI review, if any.
 * All values come from stored records; missing links are shown as missing.
 */
export function ValidationChain() {
  const { base, eid } = useEngagement();
  const list = useQuery({
    queryKey: ['present', 'validated', eid],
    queryFn: () => api.get<any>(`${base}/findings?validation_status=validated&limit=200`),
    enabled: !!eid,
    retry: 0,
  });
  const validated = items(list.data).filter((f) => f.validation_status === 'validated');
  const [sel, setSel] = useState('');
  useEffect(() => {
    if (!sel && validated[0]) setSel(validated[0].id);
  }, [validated, sel]);
  const detail = useQuery({ queryKey: ['present', 'finding', sel], queryFn: () => api.get<any>(`${base}/findings/${sel}`), enabled: !!sel, retry: 0 });

  if (list.isLoading) return <Loading rows={3} />;
  if (list.isError)
    return (
      <Notice tone="warn" title="Findings are unavailable.">
        {list.error instanceof ApiError && list.error.status === 404 ? 'The findings service did not respond on this server.' : String((list.error as Error).message)}
      </Notice>
    );
  if (!validated.length)
    return (
      <EmptyState icon={<ShieldCheck />} title="No analyst-validated finding yet" actions={<Link className="btn sm" to="/vulnerabilities">Open findings</Link>}>
        Validate one finding against its evidence (record who validated it and how) to demonstrate the validation chain here.
      </EmptyState>
    );

  const f = detail.data;
  const assets: any[] = f?.assets ?? [];
  const services: any[] = f?.services ?? [];
  const evidence: any[] = f?.evidence ?? [];
  const reviews: any[] = f?.ai_sessions ?? f?.ai_reviews ?? [];

  return (
    <div className="stack tight">
      <label className="field">
        <span className="label">Finding to walk through</span>
        <select value={sel} onChange={(e) => setSel(e.target.value)}>
          {validated.map((v) => <option key={v.id} value={v.id}>{v.code} · {v.title}</option>)}
        </select>
      </label>
      {detail.isLoading && <Loading rows={3} />}
      {detail.isError && <Notice tone="bad">Could not load the finding.</Notice>}
      {f && (
        <ol className="chain">
          <li>
            <span className="chain-step">Finding</span>
            <div className="row" style={{ gap: 8 }}>
              <Link to={`/vulnerabilities/${f.id}`}><span className="mono">{f.code}</span> {f.title}</Link>
              <SeverityBadge severity={f.severity} />
              <ValidationBadge value={f.validation_status} />
            </div>
            {f.cves && (Array.isArray(f.cves) ? f.cves : []).length > 0 && <div className="tiny faint mono">{f.cves.join(', ')}</div>}
          </li>
          <ArrowDown className="chain-arrow" aria-hidden />
          <li>
            <span className="chain-step">Affected asset / service</span>
            {assets.length || services.length ? (
              <div className="small">
                {assets.map((a) => <div key={a.id}><Link to={`/scan/assets/${a.id}`} className="mono">{a.ip ?? a.hostname}</Link> <span className="faint">{a.code}</span></div>)}
                {services.map((s) => <div key={s.id} className="mono faint">{s.port}/{s.protocol} {s.service_name ?? ''} {s.product ?? ''} {s.version ?? ''}</div>)}
              </div>
            ) : <span className="small" style={{ color: 'var(--warn)' }}>No asset linked</span>}
          </li>
          <ArrowDown className="chain-arrow" aria-hidden />
          <li>
            <span className="chain-step">Supporting evidence</span>
            <EvidenceChips items={evidence} empty={<span style={{ color: 'var(--warn)' }}>No evidence linked</span>} />
          </li>
          <ArrowDown className="chain-arrow" aria-hidden />
          <li>
            <span className="chain-step">Analyst validation</span>
            <div className="small">
              {f.validated_by ? <>Validated by <strong>{f.validated_by}</strong>{f.validated_at ? ` on ${fmtDateTime(f.validated_at)}` : ''}</> : <span className="faint">Validator not recorded</span>}
            </div>
            <div className="small muted">{f.validation_notes || <span style={{ color: 'var(--warn)' }}>No validation notes recorded: explain how you confirmed it.</span>}</div>
          </li>
          {reviews.length > 0 && (
            <>
              <ArrowDown className="chain-arrow" aria-hidden />
              <li>
                <span className="chain-step">AI assistance and human review</span>
                <div className="chips">
                  {reviews.map((r) => (
                    <Link key={r.id} to={`/ai/${r.id}`} className="row" style={{ gap: 6 }}>
                      <span className="mono">{r.code}</span>
                      <Badge tone={r.review_status?.startsWith('verified') ? 'ok' : r.review_status === 'rejected' ? 'bad' : 'ai'}>{r.review_status}</Badge>
                    </Link>
                  ))}
                </div>
              </li>
            </>
          )}
        </ol>
      )}
    </div>
  );
}
