import type { Db } from '../../db/index.js';
import { EVIDENCE_CODE_RE } from '../../lib/codes.js';

export interface CitationReport {
  valid: string[];
  not_in_context: string[];
  unknown: string[];
  included: string[];
  uncited_included: string[];
  total_mentions: number;
  note: string;
}

export const CITATION_NOTE =
  'A valid Evidence ID only shows the cited record exists and was provided in this request; it does not prove the record supports the statement. Verify each claim against the evidence.';

export function validateCitations(db: Db, eid: string, text: string, includedCodes: string[]): CitationReport {
  const mentions = text.match(new RegExp(EVIDENCE_CODE_RE.source, 'g')) ?? [];
  const unique = [...new Set(mentions.map((m) => m.toUpperCase()))];
  const included = new Set(includedCodes);
  const valid: string[] = [];
  const notIn: string[] = [];
  const unknown: string[] = [];
  for (const code of unique) {
    if (included.has(code)) valid.push(code);
    else if (db.get('SELECT 1 FROM evidence WHERE engagement_id = ? AND code = ?', eid, code)) notIn.push(code);
    else unknown.push(code);
  }
  return {
    valid,
    not_in_context: notIn,
    unknown,
    included: includedCodes,
    uncited_included: includedCodes.filter((c) => !valid.includes(c)),
    total_mentions: mentions.length,
    note: CITATION_NOTE,
  };
}

export interface AttackIdCheck {
  id: string;
  status: 'known' | 'unknown' | 'unchecked';
  name?: string;
  tactics?: string;
}

/** Extract ATT&CK technique IDs and check against cached ATT&CK data (if the references module has loaded it). */
export async function checkAttackIds(db: Db, text: string): Promise<AttackIdCheck[]> {
  const ids = [...new Set((text.match(/\bT\d{4}(?:\.\d{3})?\b/g) ?? []).map((x) => x.toUpperCase()))];
  if (!ids.length) return [];
  // Without cached ATT&CK data we cannot say whether an ID is real — report it as unchecked.
  const hasCache = db.get("SELECT 1 FROM reference_cache WHERE source = 'attack' AND status = 'ok' LIMIT 1");
  if (!hasCache) return ids.map((id) => ({ id, status: 'unchecked' as const }));
  let lookup: ((db: Db, id: string) => any) | null = null;
  try {
    const mod: any = await import('../refs.js');
    lookup = mod.lookupTechnique ?? null;
  } catch {
    lookup = null;
  }
  // Fallback: read the cached ATT&CK techniques directly.
  let cached: any[] | null = null;
  if (!lookup) {
    const row = db.get("SELECT data FROM reference_cache WHERE source = 'attack' AND status = 'ok' ORDER BY retrieved_at DESC LIMIT 1");
    if (row?.data) {
      try {
        const d = JSON.parse(row.data);
        cached = Array.isArray(d) ? d : Array.isArray(d?.techniques) ? d.techniques : null;
      } catch {
        cached = null;
      }
    }
  }
  const out: AttackIdCheck[] = [];
  for (const id of ids) out.push(await checkOne(id));
  return out;

  async function checkOne(id: string): Promise<AttackIdCheck> {
    try {
      if (lookup) {
        const t = await lookup(db, id);
        if (t === undefined) return { id, status: 'unchecked' as const };
        return t ? { id, status: 'known' as const, name: t.name, tactics: Array.isArray(t.tactics) ? t.tactics.join(', ') : t.tactics } : { id, status: 'unknown' as const };
      }
      if (cached) {
        const t = cached.find((x) => (x.id ?? x.technique_id ?? x.external_id) === id);
        return t ? { id, status: 'known' as const, name: t.name, tactics: Array.isArray(t.tactics) ? t.tactics.join(', ') : t.tactics } : { id, status: 'unknown' as const };
      }
    } catch {
      /* fall through */
    }
    return { id, status: 'unchecked' as const };
  }
}
