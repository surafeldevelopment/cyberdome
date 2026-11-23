import type { SQLInputValue } from 'node:sqlite';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { migrations } from './migrations.js';

/**
 * SQLite driver selection:
 *  1. Node's built-in `node:sqlite` (Node 22.13+; no native compilation), unless
 *     CYBERDOME_SQLITE=better-sqlite3 is set.
 *  2. `better-sqlite3` (optional dependency with prebuilt binaries) for older Node versions.
 * Both expose the same synchronous prepare().all/get/run + exec API used below.
 */
interface RawStatement {
  all(...p: unknown[]): unknown[];
  get(...p: unknown[]): unknown;
  run(...p: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}
interface RawDb {
  exec(sql: string): unknown;
  prepare(sql: string): RawStatement;
  close(): unknown;
}

const req = createRequire(import.meta.url);
let driverName = '';
function openRaw(file: string): RawDb {
  if (process.env.CYBERDOME_SQLITE !== 'better-sqlite3') {
    // Silence only the SQLite ExperimentalWarning (works on every Node version, unlike --disable-warning).
    const original = process.emitWarning;
    process.emitWarning = ((w: any, ...rest: any[]) => {
      const text = typeof w === 'string' ? w : w?.message ?? '';
      const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type ?? w?.name;
      if (type === 'ExperimentalWarning' && /sqlite/i.test(text)) return;
      return (original as any).call(process, w, ...rest);
    }) as typeof process.emitWarning;
    try {
      const { DatabaseSync } = req('node:sqlite') as typeof import('node:sqlite');
      driverName = 'node:sqlite';
      return new DatabaseSync(file) as unknown as RawDb;
    } catch {
      /* not available on this Node version: fall through */
    }
  }
  try {
    const BetterSqlite = req('better-sqlite3');
    driverName = 'better-sqlite3';
    return new BetterSqlite(file) as RawDb;
  } catch (e: any) {
    throw new Error(
      `No SQLite driver available. Use Node.js 22.13+ (built-in SQLite) or run "npm install" so the better-sqlite3 package is installed. (${e?.message ?? e})`,
    );
  }
}
export const sqliteDriver = () => driverName;

export type Row = Record<string, any>;
export type Param = SQLInputValue | boolean | undefined;

/**
 * Thin wrapper over node:sqlite with prepared-statement caching, transactions,
 * and JSON helpers. All access is synchronous (single local process).
 */
export class Db {
  readonly raw: RawDb;
  readonly file: string;
  private cache = new Map<string, RawStatement>();
  private txDepth = 0;

  constructor(file: string) {
    this.file = file;
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = openRaw(file);
    this.raw.exec('PRAGMA foreign_keys = ON;');
    if (file !== ':memory:') this.raw.exec('PRAGMA journal_mode = WAL;');
    this.raw.exec('PRAGMA busy_timeout = 5000;');
  }

  private stmt(sql: string) {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  private norm(params: Param[]): SQLInputValue[] {
    return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
  }

  all<T = Row>(sql: string, ...params: Param[]): T[] {
    return this.stmt(sql).all(...this.norm(params)) as T[];
  }
  get<T = Row>(sql: string, ...params: Param[]): T | undefined {
    return this.stmt(sql).get(...this.norm(params)) as T | undefined;
  }
  run(sql: string, ...params: Param[]) {
    return this.stmt(sql).run(...this.norm(params));
  }
  scalar<T = number>(sql: string, ...params: Param[]): T {
    const r = this.get(sql, ...params);
    return (r ? Object.values(r)[0] : null) as T;
  }

  /** Insert an object as a row. Keys must be trusted column names. */
  insert(table: string, obj: Row) {
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
    const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
    return this.run(sql, ...keys.map((k) => toSql(obj[k])));
  }

  /** Update whitelisted columns by id. */
  update(table: string, id: string, obj: Row) {
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
    if (!keys.length) return;
    const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
    return this.run(sql, ...keys.map((k) => toSql(obj[k])), id);
  }

  tx<T>(fn: () => T): T {
    if (this.txDepth > 0) {
      const sp = `sp${this.txDepth}`;
      this.raw.exec(`SAVEPOINT ${sp}`);
      this.txDepth++;
      try {
        const r = fn();
        this.raw.exec(`RELEASE ${sp}`);
        return r;
      } catch (e) {
        this.raw.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw e;
      } finally {
        this.txDepth--;
      }
    }
    this.raw.exec('BEGIN IMMEDIATE');
    this.txDepth++;
    try {
      const r = fn();
      this.raw.exec('COMMIT');
      return r;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    } finally {
      this.txDepth--;
    }
  }

  migrate() {
    this.raw.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
    const applied = new Set(this.all<{ version: number }>('SELECT version FROM schema_migrations').map((r) => r.version));
    for (const m of migrations) {
      if (applied.has(m.version)) continue;
      this.tx(() => {
        this.raw.exec(m.sql);
        this.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?,?,?)', m.version, m.name, new Date().toISOString());
      });
    }
  }

  schemaVersion(): number {
    return this.scalar<number>('SELECT COALESCE(MAX(version),0) FROM schema_migrations') ?? 0;
  }

  close() {
    this.raw.close();
  }
}

function toSql(v: any): SQLInputValue {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (Array.isArray(v) || (typeof v === 'object' && !(v instanceof Uint8Array))) return JSON.stringify(v);
  return v;
}

export function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string' || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
