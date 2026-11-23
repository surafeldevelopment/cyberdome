import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, ShieldCheck, ShieldX, ChevronDown, Eye } from 'lucide-react';
import { api, errorMessage, PREVIEW } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { useToast } from '../../components/overlay';
import { fmtRelative } from '../../lib/format';

interface Item {
  id: string;
  code: string;
  title: string;
  detected_type: string | null;
  kind: string;
  source_tool: string;
  original_filename: string | null;
  imported_at: string;
  status: string;
}

/**
 * Shows every evidence item that still needs a sanitization decision, with the decision
 * buttons right there. Items stay out of the AI analyst until they are marked
 * "No sensitive data" or "Sanitized".
 */
export function ReviewQueue() {
  const { base, eid, isDemo } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['evidence', eid, 'review-queue'],
    queryFn: () => api.get<{ items: Item[]; total: number }>(`${base}/evidence?sanitization_status=not_reviewed&status=active&limit=50&sort=code&dir=asc`),
  });
  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  if (!total) return null;

  const decide = async (it: Item, status: 'no_sensitive_data' | 'contains_sensitive') => {
    setBusy(it.id);
    try {
      await api.patch(`${base}/evidence/${it.id}`, { sanitization_status: status });
      toast.success(status === 'no_sensitive_data' ? `${it.code} marked: no sensitive data. It can now be sent to the AI analyst.` : `${it.code} marked: contains sensitive data. Open it to create a sanitized copy.`);
      qc.invalidateQueries({ queryKey: ['evidence'] });
      qc.invalidateQueries({ queryKey: ['ai-eligibility'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rq" aria-label="Evidence that needs a sanitization decision">
      <button className="rq-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ShieldAlert aria-hidden />
        <span className="rq-title">
          <strong>{total} item{total === 1 ? '' : 's'} need{total === 1 ? 's' : ''} a sanitization decision</strong>
          <span>Until you decide, {total === 1 ? 'it' : 'they'} cannot be sent to the AI analyst.</span>
        </span>
        <ChevronDown className={`rq-chev ${open ? 'open' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="rq-body">
          <details className="rq-guide">
            <summary>What counts as sensitive?</summary>
            <ul>
              <li>Passwords, password hashes, API keys, tokens, session cookies or private keys</li>
              <li>Real people's names, usernames, email addresses or phone numbers</li>
              <li>Real IP addresses, hostnames or domains that are not part of the lab</li>
              <li>Anything personal or confidential that is not needed to support a finding</li>
            </ul>
            <p>
              If none of these appear, choose <strong>No sensitive data</strong>. If some do, choose <strong>Contains sensitive</strong>, then open the item and use{' '}
              <strong>Create sanitized copy</strong> to make a redacted version the AI can use. The original is kept unchanged.
            </p>
          </details>
          <ul className="rq-list">
            {items.map((it) => (
              <li key={it.id}>
                <div className="rq-item">
                  <Link to={`/evidence/${it.id}`} className="rq-name">
                    <span className="mono">{it.code}</span> {it.title}
                  </Link>
                  <span className="faint small">
                    {[it.detected_type ?? it.kind, it.source_tool, `added ${fmtRelative(it.imported_at)}`].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <div className="rq-actions">
                  <Link className="btn ghost sm" to={`/evidence/${it.id}`} title="Open and read it first">
                    <Eye /> Check
                  </Link>
                  <button className="btn sm rq-ok" disabled={PREVIEW || busy === it.id} onClick={() => decide(it, 'no_sensitive_data')}>
                    <ShieldCheck /> No sensitive data
                  </button>
                  <button className="btn sm rq-bad" disabled={PREVIEW || busy === it.id} onClick={() => decide(it, 'contains_sensitive')}>
                    <ShieldX /> Contains sensitive
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {total > items.length && <p className="small faint" style={{ margin: '8px 0 0' }}>Showing the first {items.length} of {total}.</p>}
          {isDemo && <p className="small faint" style={{ margin: '8px 0 0' }}>Demo evidence is synthetic, so marking it is only for practice.</p>}
        </div>
      )}
    </section>
  );
}
