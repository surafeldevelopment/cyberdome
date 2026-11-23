import { parseCsv } from '../lib/csv.js';
import { normalizeTimestamp } from '../lib/time.js';

/**
 * Structured recon import (CSV or JSON). Parsing only — no network activity.
 * Template columns: category, classification, value, description, source, collected_at, analyst_notes, next_step
 */
export const RECON_CATEGORIES = ['domain', 'ip_range', 'technology', 'naming_pattern', 'public_info', 'osint_artifact', 'other'] as const;
export const RECON_CLASSIFICATIONS = ['asset_discovery', 'technology_discovery', 'identity_discovery', 'attack_surface'] as const;
export const RECON_FIELDS = ['category', 'classification', 'value', 'description', 'source', 'collected_at', 'analyst_notes', 'next_step'];

export interface ReconRow {
  row: number;
  category: string;
  classification: string;
  value: string;
  description: string;
  source: string;
  collected_at: string | null;
  collected_at_original: string | null;
  analyst_notes: string;
  next_step: string;
}

export interface ReconParse {
  format: 'csv' | 'json';
  rows: ReconRow[];
  errors: { row: number; message: string }[];
  warnings: string[];
  total: number;
}

const ALIASES: Record<string, string> = {
  type: 'category',
  class: 'classification',
  use: 'classification',
  observation: 'value',
  notes: 'analyst_notes',
  note: 'analyst_notes',
  analyst_note: 'analyst_notes',
  next: 'next_step',
  next_steps: 'next_step',
  collected: 'collected_at',
  timestamp: 'collected_at',
  date: 'collected_at',
};

const norm = (k: string) => {
  const key = k.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ALIASES[key] ?? key;
};

const normEnum = (v: string) => v.trim().toLowerCase().replace(/[\s-]+/g, '_');

export function parseRecon(text: string, filename: string, tz = 'UTC'): ReconParse {
  const trimmed = text.replace(/^﻿/, '').trim();
  const warnings: string[] = [];
  const errors: { row: number; message: string }[] = [];
  let raw: Record<string, any>[] = [];
  let format: 'csv' | 'json' = 'csv';

  if (trimmed.startsWith('[') || trimmed.startsWith('{') || /\.json$/i.test(filename)) {
    format = 'json';
    try {
      const data = JSON.parse(trimmed);
      raw = Array.isArray(data) ? data : Array.isArray(data?.observations) ? data.observations : Array.isArray(data?.items) ? data.items : [];
      if (!raw.length) errors.push({ row: 0, message: 'JSON must be an array of observations, or an object with an "observations" array.' });
    } catch (e: any) {
      errors.push({ row: 0, message: `Invalid JSON: ${e.message}` });
    }
  } else {
    const p = parseCsv(trimmed);
    raw = p.rows;
    for (const e of p.errors) errors.push({ row: e.row, message: `CSV: ${e.message}` });
    if (!p.headers.includes('value') && !p.headers.map(norm).includes('value')) errors.push({ row: 1, message: 'Missing required column "value".' });
  }

  const unknown = new Set<string>();
  const rows: ReconRow[] = [];
  raw.forEach((r, i) => {
    const rowNum = format === 'csv' ? i + 2 : i + 1;
    if (!r || typeof r !== 'object') {
      errors.push({ row: rowNum, message: 'Row is not an object.' });
      return;
    }
    const o: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) {
      const nk = norm(k);
      if (!RECON_FIELDS.includes(nk)) unknown.add(k);
      else o[nk] = v === null || v === undefined ? '' : String(v).trim();
    }
    const problems: string[] = [];
    if (!o.value) problems.push('value is required');
    const category = normEnum(o.category || 'other');
    if (!(RECON_CATEGORIES as readonly string[]).includes(category)) problems.push(`unknown category "${o.category}"`);
    const classification = normEnum(o.classification || '');
    if (!(RECON_CLASSIFICATIONS as readonly string[]).includes(classification))
      problems.push(o.classification ? `unknown classification "${o.classification}"` : 'classification is required (asset_discovery, technology_discovery, identity_discovery, attack_surface)');
    if (o.value && o.value.length > 2000) problems.push('value longer than 2000 characters');
    let collected: string | null = null;
    if (o.collected_at) {
      const t = normalizeTimestamp(o.collected_at, tz);
      if (t.normalized) collected = t.normalized;
      else warnings.push(`Row ${rowNum}: collected_at "${o.collected_at}" could not be placed on the clock; stored without a collection time.`);
    }
    if (problems.length) {
      errors.push({ row: rowNum, message: problems.join('; ') });
      return;
    }
    rows.push({
      row: rowNum,
      category,
      classification,
      value: o.value.slice(0, 2000),
      description: (o.description ?? '').slice(0, 10000),
      source: (o.source ?? '').slice(0, 500),
      collected_at: collected,
      collected_at_original: o.collected_at || null,
      analyst_notes: (o.analyst_notes ?? '').slice(0, 10000),
      next_step: (o.next_step ?? '').slice(0, 4000),
    });
  });
  if (unknown.size) warnings.unshift(`Ignored unknown field(s): ${[...unknown].join(', ')}`);
  return { format, rows, errors, warnings, total: raw.length };
}
