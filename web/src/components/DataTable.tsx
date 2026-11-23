import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  /** Value used for sorting; defaults to row[key]. Set sortable:false to disable. */
  sortValue?: (row: T) => string | number | null | undefined;
  sortable?: boolean;
  className?: string;
  width?: number | string;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  pageSize?: number;
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (s: Set<string>) => void;
  caption: string;
  rowClassName?: (row: T) => string;
  /** When true, sorting is disabled (e.g. server-sorted lists) */
  manualSort?: boolean;
}

const cmp = (a: any, b: any) => {
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return 1;
  if (b === null || b === undefined || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
};

/**
 * Client-side table with sorting, pagination, and selection. "Select all" selects every
 * row in `rows` (all filtered records), not just the visible page.
 */
export function DataTable<T>({ rows, columns, rowKey, onRowClick, empty, initialSort, pageSize = 50, selectable, selected, onSelectedChange, caption, rowClassName, manualSort }: Props<T>) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [rows.length]);

  const sorted = useMemo(() => {
    if (!sort || manualSort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const get = col.sortValue ?? ((r: any) => r[col.key]);
    const out = [...rows].sort((a, b) => cmp(get(a), get(b)));
    return sort.dir === 'desc' ? out.reverse() : out;
  }, [rows, sort, columns, manualSort]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const visible = sorted.slice(page * pageSize, page * pageSize + pageSize);
  const allSelected = selectable && selected && rows.length > 0 && rows.every((r) => selected.has(rowKey(r)));

  const toggleAll = () => {
    if (!onSelectedChange) return;
    onSelectedChange(allSelected ? new Set() : new Set(rows.map(rowKey)));
  };
  const toggle = (id: string) => {
    if (!onSelectedChange || !selected) return;
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    onSelectedChange(s);
  };

  if (!rows.length) return <>{empty}</>;

  return (
    <>
      <div className="table-wrap">
        <table className="data">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {selectable && (
                <th style={{ width: 36 }}>
                  <input type="checkbox" aria-label={`Select all ${rows.length} records`} checked={!!allSelected} onChange={toggleAll} />
                </th>
              )}
              {columns.map((c) => {
                const sortable = !manualSort && c.sortable !== false;
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} style={{ width: c.width }} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {sortable ? (
                      <button onClick={() => setSort(active && sort!.dir === 'asc' ? { key: c.key, dir: 'desc' } : { key: c.key, dir: 'asc' })}>
                        {c.header}
                        {active ? sort!.dir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} /> : <ArrowUpDown size={12} opacity={0.4} />}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const id = rowKey(r);
              return (
                <tr
                  key={id}
                  className={`${onRowClick ? 'clickable' : ''} ${selected?.has(id) ? 'selected' : ''} ${rowClassName?.(r) ?? ''}`}
                  onClick={onRowClick ? (e) => {
                    if ((e.target as HTMLElement).closest('a,button,input,select,label')) return;
                    onRowClick(r);
                  } : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick(r); } : undefined}
                >
                  {selectable && (
                    <td>
                      <input type="checkbox" aria-label={`Select ${id}`} checked={!!selected?.has(id)} onChange={() => toggle(id)} />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.key} className={c.className}>
                      {c.render ? c.render(r) : ((r as any)[c.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="table-foot">
        <span>
          {rows.length} record{rows.length === 1 ? '' : 's'}
          {selectable && selected && selected.size > 0 && ` · ${selected.size} selected${allSelected && pages > 1 ? ' (all pages)' : ''}`}
        </span>
        {pages > 1 && (
          <span className="row" style={{ marginLeft: 'auto', gap: 6 }}>
            <button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
            <span className="small">Page {page + 1} of {pages}</span>
            <button className="btn sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
          </span>
        )}
      </div>
    </>
  );
}

/** Client-side text filter helper across chosen fields. */
export function matchText<T>(row: T, q: string, fields: (keyof T | ((r: T) => any))[]): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return fields.some((f) => {
    const v = typeof f === 'function' ? f(row) : (row as any)[f];
    return v !== null && v !== undefined && String(v).toLowerCase().includes(needle);
  });
}
