import Papa from 'papaparse';

/** Serialize rows to CSV. Neutralizes spreadsheet formula injection (=, +, -, @ prefixes). */
export function toCsv(rows: Record<string, any>[], columns?: string[]): string {
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const safe = rows.map((r) =>
    Object.fromEntries(
      cols.map((c) => {
        let v = r[c];
        if (v === null || v === undefined) v = '';
        if (typeof v === 'object') v = JSON.stringify(v);
        v = String(v);
        if (/^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v)) v = `'${v}`;
        return [c, v];
      }),
    ),
  );
  return '﻿' + Papa.unparse({ fields: cols, data: safe.map((r) => cols.map((c) => r[c])) });
}

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  errors: { row: number; message: string }[];
}

export function parseCsv(text: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'),
  });
  return {
    headers: result.meta.fields ?? [],
    rows: result.data,
    errors: result.errors.map((e) => ({ row: (e.row ?? 0) + 2, message: e.message })),
  };
}
