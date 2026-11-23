/**
 * CLI: npm run backup [-- --out <file.zip>]
 * Creates a consistent snapshot (safe while the server is running) under ./backups/.
 */
import path from 'node:path';
import { loadConfig } from '../config.js';
import { Db } from '../db/index.js';
import { createBackup } from './backup-core.js';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const cfg = loadConfig();
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.resolve(outIdx >= 0 ? args[outIdx + 1] : path.join(process.cwd(), 'backups', `cyberdome-backup-${stamp}.zip`));

const db = new Db(cfg.dbFile);
db.migrate();
createBackup(db, cfg, out)
  .then((m) => {
    db.close();
    const bytes = m.files.reduce((a, f) => a + f.size, 0);
    console.log(`Backup written: ${out}`);
    console.log(`  schema v${m.schema_version}, ${m.files.length} files (${(bytes / 1024 / 1024).toFixed(2)} MB before compression)`);
    console.log('  Restore with: npm run restore -- "' + out + '"');
  })
  .catch((e) => {
    db.close();
    console.error('Backup failed:', e?.message ?? e);
    process.exit(1);
  });
