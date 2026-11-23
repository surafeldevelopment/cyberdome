import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Network } from 'lucide-react';
import type { MatrixCell } from './types';
import { EmptyState } from '../../components/ui';

const SEV_LABEL: Record<number, [string, string]> = {
  5: ['C', 'Critical'],
  4: ['H', 'High'],
  3: ['M', 'Medium'],
  2: ['L', 'Low'],
  1: ['I', 'Info'],
};

/**
 * Hero: assets (rows) × open port/protocol (columns). Each filled cell is a currently-open
 * service from the inventory; its fill shows the worst open, non-false-positive finding linked
 * to that service, with a letter so color is never the only cue.
 */
export function ExposureMatrix({ cells }: { cells: MatrixCell[] }) {
  const nav = useNavigate();
  const wrap = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ cell: MatrixCell; x: number; y: number } | null>(null);

  const { rows, cols, index } = useMemo(() => {
    const colKeys = new Map<string, { port: number; protocol: string }>();
    const rowMap = new Map<string, { asset_id: string; code: string; ip: string | null; hostname: string }>();
    const idx = new Map<string, MatrixCell>();
    for (const c of cells) {
      colKeys.set(`${c.port}/${c.protocol}`, { port: c.port, protocol: c.protocol });
      rowMap.set(c.asset_id, { asset_id: c.asset_id, code: c.asset_code, ip: c.ip, hostname: c.hostname });
      idx.set(`${c.asset_id}|${c.port}/${c.protocol}`, c);
    }
    const colsSorted = [...colKeys.entries()].sort((a, b) => a[1].protocol.localeCompare(b[1].protocol) || a[1].port - b[1].port).map(([k]) => k);
    return { rows: [...rowMap.values()], cols: colsSorted, index: idx };
  }, [cells]);

  if (!cells.length)
    return (
      <EmptyState
        icon={<Network />}
        title="No scan data imported yet"
        actions={<Link className="btn primary" to="/scan?tab=import">Import an authorized Nmap XML</Link>}
      >
        The exposure matrix fills in from open services in your imported scan results. Nothing is shown until real or instructor-supplied scan output is imported.
      </EmptyState>
    );

  const show = (cell: MatrixCell, el: HTMLElement) => {
    const w = wrap.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!w) return;
    setTip({ cell, x: Math.min(r.left - w.left + r.width / 2, w.width - 140), y: r.bottom - w.top + 6 });
  };

  return (
    <div className="xm" ref={wrap} onMouseLeave={() => setTip(null)}>
      <div className="matrix-wrap">
        <table className="matrix" aria-label="Exposure matrix: assets by open port">
          <thead>
            <tr>
              <th scope="col" className="host"><span className="sr-only">Asset</span></th>
              {cols.map((c) => (
                <th key={c} scope="col" className="port">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.asset_id}>
                <th scope="row" className="host">
                  <Link to={`/scan/assets/${r.asset_id}`} className="xm-host">
                    <span className="mono">{r.ip ?? r.hostname}</span>
                    <span className="faint tiny">{r.code}{r.hostname && r.ip ? ` · ${r.hostname}` : ''}</span>
                  </Link>
                </th>
                {cols.map((c) => {
                  const cell = index.get(`${r.asset_id}|${c}`);
                  if (!cell)
                    return (
                      <td key={c}>
                        <span className="cell empty-cell" aria-hidden />
                      </td>
                    );
                  const sev = cell.worst ? SEV_LABEL[cell.worst] : null;
                  const label = `${r.ip ?? r.hostname} ${c} ${cell.service_name ?? 'unknown service'}, ${sev ? `worst open finding ${sev[1]}` : 'open, no linked finding'}${cell.needs_investigation ? ', flagged for investigation' : ''}`;
                  return (
                    <td key={c}>
                      <button
                        className={`cell ${sev ? `sev-${cell.worst}` : 'open'} ${cell.needs_investigation ? 'flag' : ''}`}
                        aria-label={label}
                        onMouseEnter={(e) => show(cell, e.currentTarget)}
                        onFocus={(e) => show(cell, e.currentTarget)}
                        onBlur={() => setTip(null)}
                        onClick={() => nav(`/scan/assets/${cell.asset_id}`)}
                      >
                        {sev ? sev[0] : '·'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tip && (
        <div className="xm-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
          <div className="mono">
            {tip.cell.ip ?? tip.cell.hostname} : {tip.cell.port}/{tip.cell.protocol}
          </div>
          <div>{tip.cell.service_name ?? 'Service not identified'}</div>
          <div className="muted small">
            {tip.cell.product || tip.cell.version ? `${tip.cell.product ?? ''} ${tip.cell.version ?? ''}`.trim() : 'No product/version reported'}
            {' · '}version {tip.cell.version_status}
          </div>
          <div className="small">
            {tip.cell.worst ? `Worst open finding: ${SEV_LABEL[tip.cell.worst][1]}` : 'No open finding linked to this service'}
          </div>
          {!!tip.cell.needs_investigation && <div className="small" style={{ color: 'var(--warn)' }}>Flagged for further investigation</div>}
        </div>
      )}
      <div className="legend xm-legend" aria-label="Legend">
        <span><span className="cell open legend-cell">·</span> Open, no linked finding</span>
        {[5, 4, 3, 2, 1].map((s) => (
          <span key={s}><span className={`cell sev-${s} legend-cell`}>{SEV_LABEL[s][0]}</span> {SEV_LABEL[s][1]} finding</span>
        ))}
        <span><span className="cell open flag legend-cell">·</span> Flagged for investigation</span>
      </div>
    </div>
  );
}
