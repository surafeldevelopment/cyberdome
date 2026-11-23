import type { Db } from '../db/index.js';

export type ScopeStatus = 'in_scope' | 'excluded' | 'not_in_scope' | 'no_scope_defined';
export interface ScopeResult {
  status: ScopeStatus;
  confirmed: boolean;
  matched?: { id: string; target: string; kind: string };
}

const ipToInt = (ip: string) => {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
};

export const isIPv4 = (s: string) => ipToInt(s) !== null;

function matches(target: string, type: string, ip: string | null, host: string | null): boolean {
  const t = target.trim().toLowerCase();
  const hostL = (host ?? '').toLowerCase();
  if (ip) {
    const ipN = ipToInt(ip);
    if (ipN !== null) {
      const cidr = t.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/);
      if (cidr) {
        const base = ipToInt(cidr[1]);
        const bits = Number(cidr[2]);
        if (base !== null && bits <= 32) {
          const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
          if (((ipN & mask) >>> 0) === ((base & mask) >>> 0)) return true;
        }
      }
      const range = t.match(/^(\d+\.\d+\.\d+\.\d+)\s*-\s*(\d+(?:\.\d+\.\d+\.\d+)?)$/);
      if (range) {
        const start = ipToInt(range[1]);
        const endRaw = range[2].includes('.') ? range[2] : range[1].split('.').slice(0, 3).join('.') + '.' + range[2];
        const end = ipToInt(endRaw);
        if (start !== null && end !== null && ipN >= start && ipN <= end) return true;
      }
      if (t === ip) return true;
    }
  }
  if (hostL && (type === 'domain' || type === 'hostname' || type === 'other' || type === 'url')) {
    const d = t.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, '');
    if (hostL === d || hostL.endsWith('.' + d)) return true;
  }
  return false;
}

/**
 * Check a host against the engagement scope. Exclusions always win. A private IP is
 * never assumed to be authorized — only explicit scope entries count.
 */
export function checkScope(db: Db, engagementId: string, ip: string | null, hostname: string | null): ScopeResult {
  const entries = db.all<{ id: string; kind: string; target: string; target_type: string; confirmed: number }>(
    'SELECT id, kind, target, target_type, confirmed FROM scope_entries WHERE engagement_id = ?',
    engagementId,
  );
  if (!entries.some((e) => e.kind === 'in')) {
    const ex = entries.find((e) => e.kind === 'out' && matches(e.target, e.target_type, ip, hostname));
    if (ex) return { status: 'excluded', confirmed: !!ex.confirmed, matched: { id: ex.id, target: ex.target, kind: ex.kind } };
    return { status: 'no_scope_defined', confirmed: false };
  }
  const ex = entries.find((e) => e.kind === 'out' && matches(e.target, e.target_type, ip, hostname));
  if (ex) return { status: 'excluded', confirmed: !!ex.confirmed, matched: { id: ex.id, target: ex.target, kind: ex.kind } };
  const inn = entries.find((e) => e.kind === 'in' && matches(e.target, e.target_type, ip, hostname));
  if (inn) return { status: 'in_scope', confirmed: !!inn.confirmed, matched: { id: inn.id, target: inn.target, kind: inn.kind } };
  return { status: 'not_in_scope', confirmed: false };
}

export function inferTargetType(target: string): string {
  const t = target.trim();
  if (/^\d+\.\d+\.\d+\.\d+\/\d{1,2}$/.test(t)) return 'cidr';
  if (/^\d+\.\d+\.\d+\.\d+\s*-\s*\d+/.test(t)) return 'range';
  if (isIPv4(t)) return 'ip';
  if (/^https?:\/\//i.test(t)) return 'url';
  if (/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(t)) return 'domain';
  if (/^[a-z0-9-]+$/i.test(t)) return 'hostname';
  return 'other';
}
