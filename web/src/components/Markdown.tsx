import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Minimal, safe Markdown renderer (no HTML injection): headings, lists, paragraphs, bold,
 * italics, inline code, blockquotes, simple tables. Evidence IDs become links when a
 * resolver is provided; unknown IDs are flagged.
 */
export interface CitationResolver {
  (code: string): { id?: string; state: 'valid' | 'not_in_context' | 'unknown' } | null;
}

const CITE_RE = /\b((?:DEMO-)?EV-\d{3,})\b/g;

function inline(text: string, resolve?: CitationResolver, keyBase = ''): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  const pushText = (t: string) => {
    if (!resolve) return out.push(t);
    let l = 0;
    let c: RegExpExecArray | null;
    CITE_RE.lastIndex = 0;
    while ((c = CITE_RE.exec(t))) {
      if (c.index > l) out.push(t.slice(l, c.index));
      const code = c[1];
      const r = resolve(code);
      if (r?.state === 'valid' && r.id)
        out.push(<Link key={`${keyBase}c${k++}`} to={`/evidence/${r.id}`} className="ev-chip" title="Cited evidence (included in this request)">{code}</Link>);
      else
        out.push(
          <span key={`${keyBase}c${k++}`} className="ev-chip invalid" title={r?.state === 'not_in_context' ? 'This evidence exists but was NOT included in the request context' : 'No evidence with this ID exists in this engagement'}>
            {code} {r?.state === 'not_in_context' ? '(not in context)' : '(unknown ID)'}
          </span>,
        );
      l = c.index + code.length;
    }
    if (l < t.length) out.push(t.slice(l));
  };
  while ((m = re.exec(text))) {
    if (m.index > last) pushText(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<strong key={`${keyBase}b${k++}`}>{inline(tok.slice(2, -2), resolve, `${keyBase}b${k}`)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={`${keyBase}k${k++}`}>{tok.slice(1, -1)}</code>);
    else out.push(<em key={`${keyBase}i${k++}`}>{inline(tok.slice(1, -1), resolve, `${keyBase}i${k}`)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) pushText(text.slice(last));
  return out;
}

export function Markdown({ text, resolve }: { text: string; resolve?: CitationResolver }) {
  const lines = (text ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const Tag = (`h${Math.min(h[1].length + 1, 4)}`) as 'h2';
      blocks.push(<Tag key={key++}>{inline(h[2], resolve, `h${key}`)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(item);
      }
      const L = ordered ? 'ol' : 'ul';
      blocks.push(<L key={key++}>{items.map((it, j) => <li key={j}>{inline(it, resolve, `l${key}-${j}`)}</li>)}</L>);
      continue;
    }
    if (line.startsWith('>')) {
      const q: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) q.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(<blockquote key={key++}>{inline(q.join(' '), resolve, `q${key}`)}</blockquote>);
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|')) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={key++} style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, resolve)}</th>)}</tr></thead>
            <tbody>{rows.map((r, j) => <tr key={j}>{r.map((c, x) => <td key={x}>{inline(c, resolve, `t${j}${x}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={key++} className="code-block wrap">{code.join('\n')}</pre>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|>|\s*([-*+]|\d+[.)])\s+|```)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={key++}>{inline(para.join(' '), resolve, `p${key}`)}</p>);
  }
  return <div className="md">{blocks.map((b, j) => <Fragment key={j}>{b}</Fragment>)}</div>;
}
