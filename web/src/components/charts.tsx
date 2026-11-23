import { useId, useMemo, useRef, useState, type ReactNode } from 'react';

/** Chart palette: one green accent ramp plus distinct, label-paired status hues. */
export const PALETTE = {
  green: '#3dcc7e', greenLight: '#7fe0a6', greenDark: '#2a9a5e', greenDeep: '#1f6b43',
  blue: '#5b8fd0', amber: '#e8b84a', orange: '#f08a3e', red: '#e5484d', grey: '#4a524c',
};
export const SEVERITY_COLORS: Record<string, string> = { critical: PALETTE.red, high: PALETTE.orange, medium: PALETTE.amber, low: PALETTE.blue, info: '#6b756e' };

export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
  onClick?: () => void;
  /** Optional glyph/text so identity isn't conveyed by color alone */
  marker?: ReactNode;
}

function arcPath(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(rOuter, a0);
  const [x1, y1] = p(rOuter, a1);
  const [x2, y2] = p(rInner, a1);
  const [x3, y3] = p(rInner, a0);
  return `M${x0} ${y0} A${rOuter} ${rOuter} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${rInner} ${rInner} 0 ${large} 0 ${x3} ${y3} Z`;
}

/**
 * Donut with a total in the center (reference style: thick ring, rounded gaps, inner disc).
 * Each segment is a button: keyboard focusable, labeled, and clickable.
 */
export function Donut({ segments, centerLabel, centerValue, size = 220, thickness = 34, ariaLabel }: { segments: Segment[]; centerLabel: string; centerValue: ReactNode; size?: number; thickness?: number; ariaLabel: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = segments.reduce((a, s) => a + s.value, 0);
  const c = size / 2;
  const rO = c - 4;
  const rI = rO - thickness;
  const gap = total > 0 && segments.filter((s) => s.value > 0).length > 1 ? 0.035 : 0;
  let a = -Math.PI / 2;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const span = (s.value / total) * Math.PI * 2;
      const a0 = a + gap / 2;
      const a1 = a + span - gap / 2;
      a += span;
      return { s, d: arcPath(c, c, hover === s.key ? rO + 3 : rO, rI, a0, Math.max(a0 + 0.001, a1 - (span >= Math.PI * 2 - 0.0001 ? 0.0001 : 0))) };
    });
  const hovered = segments.find((s) => s.key === hover);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: size, display: 'block' }} role="group" aria-label={ariaLabel}>
      <circle cx={c} cy={c} r={rO} fill="#141815" />
      {arcs.map(({ s, d }) => (
        <path
          key={s.key}
          d={d}
          fill={s.color}
          stroke="#0d0f0e"
          strokeWidth={1.5}
          tabIndex={s.onClick ? 0 : -1}
          role={s.onClick ? 'button' : 'img'}
          aria-label={`${s.label}: ${s.value} of ${total}`}
          style={{ cursor: s.onClick ? 'pointer' : 'default', outline: 'none', transition: 'd 0.12s' }}
          onMouseEnter={() => setHover(s.key)}
          onMouseLeave={() => setHover(null)}
          onFocus={() => setHover(s.key)}
          onBlur={() => setHover(null)}
          onClick={s.onClick}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && s.onClick?.()}
        >
          <title>{`${s.label}: ${s.value}`}</title>
        </path>
      ))}
      <circle cx={c} cy={c} r={rI - 10} fill="#0d0f0e" stroke="#1b201c" />
      <text x={c} y={c - 6} textAnchor="middle" fill="#9ba59e" fontSize={size * 0.075} fontFamily="Nunito Sans, sans-serif">
        {hovered ? hovered.label : centerLabel}
      </text>
      <text x={c} y={c + size * 0.085} textAnchor="middle" fill="#e6ebe7" fontSize={size * 0.09} fontFamily="Nunito Sans, sans-serif">
        {hovered ? hovered.value : centerValue}
      </text>
    </svg>
  );
}

/** Legend rows: colored dot + label + value (value in text, not color). */
export function LegendList({ segments }: { segments: Segment[] }) {
  return (
    <ul className="legend-list">
      {segments.map((s) => (
        <li key={s.key}>
          <button type="button" onClick={s.onClick} disabled={!s.onClick} aria-label={`${s.label}: ${s.value}`}>
            <span className="lg-dot" style={{ background: s.color }}>{s.marker}</span>
            <span className="lg-label">{s.label}</span>
            <span className="lg-val">{s.value}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Thick multi-color ring (reference "Alerts by severity" style) with stacked square legend. */
export function Ring({ segments, center, sub, size = 210, ariaLabel }: { segments: Segment[]; center: ReactNode; sub: string; size?: number; ariaLabel: string }) {
  return (
    <div className="ring-wrap">
      <ul className="ring-legend">
        {segments.map((s) => (
          <li key={s.key}>
            <button type="button" onClick={s.onClick} disabled={!s.onClick}>
              <span className="sq" style={{ background: s.color }} aria-hidden />
              <span>
                <span className="rl-label">{s.label}</span>
                <span className="rl-val">{s.value}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="ring-chart">
        <Donut segments={segments} centerLabel={sub} centerValue={center} size={size} thickness={30} ariaLabel={ariaLabel} />
      </div>
    </div>
  );
}

/**
 * Area chart (2px green line, faint flat fill) with crosshair + tooltip on hover/focus.
 * Values are plotted as-is; nothing is smoothed or interpolated beyond straight segments.
 */
export function AreaChart({ labels, values, height = 230, valueLabel, formatX }: { labels: string[]; values: number[]; height?: number; valueLabel: string; formatX?: (s: string) => string }) {
  const gid = useId().replace(/:/g, '');
  const ref = useRef<SVGSVGElement>(null);
  const [idx, setIdx] = useState<number | null>(null);
  const W = 720;
  const H = height;
  const padL = 44, padR = 14, padT = 14, padB = 30;
  const max = Math.max(1, ...values);
  const niceMax = useMemo(() => {
    const p = Math.pow(10, Math.floor(Math.log10(max)));
    const n = [1, 2, 2.5, 5, 10].find((m) => m * p >= max)! * p;
    return n;
  }, [max]);
  const n = values.length;
  const x = (i: number) => padL + (n <= 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => padT + (1 - v / niceMax) * (H - padT - padB);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = n ? `${line} L${x(n - 1)} ${H - padB} L${x(0)} ${H - padB} Z` : '';
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(niceMax * t));
  const xTickEvery = Math.max(1, Math.ceil(n / 7));
  const fmt = formatX ?? ((s: string) => s);

  const onMove = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !n) return;
    const sx = ((clientX - r.left) / r.width) * W;
    const i = Math.round(((sx - padL) / (W - padL - padR)) * (n - 1));
    setIdx(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div className="area-chart" style={{ position: 'relative' }}>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`${valueLabel} per day. ${n} days. Maximum ${max}.`}
        tabIndex={0}
        onMouseMove={(e) => onMove(e.clientX)}
        onMouseLeave={() => setIdx(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setIdx((i) => Math.min(n - 1, (i ?? -1) + 1));
          if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, (i ?? n) - 1));
        }}
        onBlur={() => setIdx(null)}
        style={{ display: 'block', outline: 'none' }}
      >
        <defs>
          <linearGradient id={`ag${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3dcc7e" stopOpacity="0.14" />
            <stop offset="1" stopColor="#3dcc7e" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#1b201c" strokeWidth={1} />
            <text x={padL - 10} y={y(t) + 4} textAnchor="end" fill="#808a83" fontSize="11" fontFamily="Nunito Sans, sans-serif">{t >= 1000 ? `${t / 1000}k` : t}</text>
          </g>
        ))}
        {n > 0 && <path d={area} fill={`url(#ag${gid})`} />}
        {n > 0 && <path d={line} fill="none" stroke="#3dcc7e" strokeWidth={2} strokeLinejoin="round" />}
        {n === 1 && <circle cx={x(0)} cy={y(values[0])} r={4} fill="#3dcc7e" />}
        {labels.map((l, i) =>
          i % xTickEvery === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fill="#9ba59e" fontSize="11" fontFamily="Nunito Sans, sans-serif">{fmt(l)}</text>
          ) : null,
        )}
        {idx !== null && n > 0 && (
          <g>
            <line x1={x(idx)} x2={x(idx)} y1={padT} y2={H - padB} stroke="#4a5a4f" strokeDasharray="3 3" />
            <circle cx={x(idx)} cy={y(values[idx])} r={5} fill="#3dcc7e" stroke="#0d0f0e" strokeWidth={2} />
          </g>
        )}
      </svg>
      {idx !== null && n > 0 && (
        <div className="chart-tip" style={{ left: `${(x(idx) / W) * 100}%` }} role="status">
          <div className="faint tiny">{labels[idx]}</div>
          <div><strong>{values[idx]}</strong> {valueLabel}</div>
        </div>
      )}
    </div>
  );
}
