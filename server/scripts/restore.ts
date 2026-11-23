/**
 * CLI: npm run restore -- <backup.zip | extracted-backup-dir> [--force] [--verify-only]
 *
 * 1. Reads the backup (zip or directory) and verifies every SHA-256 in manifest.json.
 * 2. Refuses to run while a server is listening on the configured port (unless --force).
 * 3. Moves the current data directory to <data>.before-restore-<timestamp> (nothing is deleted).
 * 4. Writes the snapshot database and evidence files.
 */
import { loadConfig } from '../config.js';
import { loadBackup, verifyBackup, writeRestore, isPortOpen } from './backup-core.js';

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const verifyOnly = args.includes('--verify-only');
  const source = args.find((a) => !a.startsWith('--'));
  if (!source) {
    console.error('Usage: npm run restore -- <backup.zip | backup-directory> [--force] [--verify-only]');
    process.exit(2);
  }
  const cfg = loadConfig();

  console.log(`Reading ${source} …`);
  const files = loadBackup(source);
  const { manifest, problems } = verifyBackup(files);
  console.log(`  Backup created ${manifest.created_at}, schema v${manifest.schema_version}, ${manifest.files.length} files.`);
  if (problems.length) {
    console.error('Backup verification FAILED. Nothing was changed.');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('  All SHA-256 hashes match the manifest.');
  if (verifyOnly) return;

  const running = await isPortOpen(cfg.host === '0.0.0.0' ? '127.0.0.1' : cfg.host, cfg.port);
  if (running && !force) {
    console.error(`A server appears to be running on ${cfg.host}:${cfg.port}. Stop it (Ctrl+C) and run restore again, or pass --force.`);
    process.exit(1);
  }

  const { movedTo } = writeRestore(files, manifest, cfg.dataDir);
  if (movedTo) console.log(`  Previous data moved to ${movedTo}`);
  console.log(`Restore complete into ${cfg.dataDir}. Start the app with: npm start`);
}

main().catch((e) => {
  console.error('Restore failed:', e?.message ?? e);
  process.exit(1);
});
