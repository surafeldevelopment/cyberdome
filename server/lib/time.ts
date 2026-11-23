/**
 * Timestamp normalization that never invents information.
 *
 * - Original strings are always preserved by callers.
 * - If the string carries an explicit offset/Z, it is converted to UTC ('explicit_offset').
 * - If it has a date and time but no offset, it is interpreted in the declared source
 *   timezone ('assumed_timezone') — callers must record which timezone was assumed.
 * - Missing or unparseable values return normalized = null. We never fill in a time.
 */
export type TsStatus = 'explicit_offset' | 'assumed_timezone' | 'missing' | 'unparseable';

export interface NormalizedTs {
  original: string | null;
  normalized: string | null;
  status: TsStatus;
}

const OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/i;

export function normalizeTimestamp(input: unknown, sourceTz = 'UTC'): NormalizedTs {
  if (input === null || input === undefined) return { original: null, normalized: null, status: 'missing' };
  let s = String(input).trim();
  if (!s || s === '-' || /^(null|none|n\/a)$/i.test(s)) return { original: s || null, normalized: null, status: 'missing' };

  // Epoch seconds / milliseconds (e.g. tshark frame.time_epoch)
  if (/^\d{9,10}(\.\d+)?$/.test(s)) {
    const d = new Date(parseFloat(s) * 1000);
    return { original: s, normalized: d.toISOString(), status: 'explicit_offset' };
  }
  if (/^\d{13}$/.test(s)) return { original: s, normalized: new Date(Number(s)).toISOString(), status: 'explicit_offset' };

  // tshark "Oct 19, 2026 10:03:01.123456000 EDT" style -> strip nanos beyond ms, keep tz abbreviation
  const tsharkLike = s.match(/^([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+\d{2}:\d{2}:\d{2})(\.\d+)?\s*([A-Z]{2,5})?$/);
  if (tsharkLike) {
    const abbr = tsharkLike[3];
    const off = abbr ? TZ_ABBR[abbr] : undefined;
    const ms = tsharkLike[2] ? tsharkLike[2].slice(0, 4) : '';
    const base = new Date(`${tsharkLike[1]}${ms ? '' : ''} UTC`);
    if (!isNaN(base.getTime())) {
      const withMs = new Date(base.getTime() + (ms ? Math.round(parseFloat(ms) * 1000) : 0));
      if (off !== undefined) return { original: s, normalized: new Date(withMs.getTime() - off * 60000).toISOString(), status: 'explicit_offset' };
      return { original: s, normalized: shiftFromZone(withMs, sourceTz), status: 'assumed_timezone' };
    }
  }

  // ISO-like: 2026-10-19 10:03:01, 2026-10-19T10:03:01.5Z, 2026/10/19 10:03
  let iso = s.replace(/^(\d{4})\/(\d{2})\/(\d{2})/, '$1-$2-$3');
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(\s*(Z|[+-]\d{2}:?\d{2}))?$/i.test(iso)) {
    iso = iso.replace(' ', 'T').replace(/\s+(Z|[+-]\d{2}:?\d{2})$/i, '$1');
    if (OFFSET_RE.test(iso)) {
      const fixed = iso.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
      const d = new Date(fixed);
      if (!isNaN(d.getTime())) return { original: s, normalized: d.toISOString(), status: 'explicit_offset' };
      return { original: s, normalized: null, status: 'unparseable' };
    }
    const d = new Date(iso + 'Z');
    if (!isNaN(d.getTime())) return { original: s, normalized: shiftFromZone(d, sourceTz), status: 'assumed_timezone' };
  }

  // Date only is NOT enough to place an event in time precisely; keep it as unparseable-for-time.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { original: s, normalized: null, status: 'unparseable' };

  // RFC 2822 / other strings with explicit zone
  if (/\b(GMT|UTC|[+-]\d{4})\b/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return { original: s, normalized: d.toISOString(), status: 'explicit_offset' };
  }

  // Syslog "Oct 19 10:03:01" has no year — we refuse to guess the year.
  return { original: s, normalized: null, status: 'unparseable' };
}

const TZ_ABBR: Record<string, number> = {
  UTC: 0, GMT: 0, Z: 0,
  EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420,
  CET: 60, CEST: 120, BST: 60, IST: 330, JST: 540, EAT: 180,
};

/**
 * Treat the wall-clock fields of `wall` (stored as if UTC) as local time in `tz`
 * and return the true UTC instant. Uses Intl to find the zone offset at that instant.
 */
export function shiftFromZone(wall: Date, tz: string): string {
  if (!tz || tz === 'UTC') return wall.toISOString();
  try {
    const guess = wall.getTime();
    const off1 = zoneOffsetMinutes(new Date(guess), tz);
    let utc = guess - off1 * 60000;
    const off2 = zoneOffsetMinutes(new Date(utc), tz);
    if (off2 !== off1) utc = guess - off2 * 60000;
    return new Date(utc).toISOString();
  } catch {
    return wall.toISOString();
  }
}

function zoneOffsetMinutes(d: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
