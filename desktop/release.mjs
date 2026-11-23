// Publish a new CyberDome version so every installed copy offers it as an update.
//
//   npm run release -- 1.2.0 "What changed in this version"
//
// 1. Sets the version in package.json.
// 2. Builds desktop/out/CyberDomeInstaller.exe (npm run installer).
// 3. Writes desktop/out/latest.json (version, notes, download URL, SHA-256, size).
// 4. If the GitHub CLI (gh) is installed and signed in, creates the release on
//    github.com/<UPDATE_REPO> with both files. Otherwise prints the two files to upload by hand.
//
// Installed apps read https://github.com/<UPDATE_REPO>/releases/latest/download/latest.json.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UPDATE_REPO = process.env.CYBERDOME_UPDATE_REPO || 'surafeldevelopment/cyberdome';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'out');
const isWin = process.platform === 'win32';

const [version, ...noteParts] = process.argv.slice(2);
const notes = noteParts.join(' ').trim();
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: npm run release -- <version> "<release notes>"\n  Example: npm run release -- 1.2.0 "Faster scans and a new report layout"');
  process.exit(1);
}

const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const cmp = (a, b) => a.split('.').map(Number).reduce((r, n, i) => r || n - Number(b.split('.')[i] ?? 0), 0);
if (cmp(version, pkg.version) < 0) {
  console.error(`Version ${version} is lower than the current ${pkg.version}. Installed copies only update to a higher version.`);
  process.exit(1);
}
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`> Version set to ${version}`);

execFileSync(isWin ? 'npm.cmd' : 'npm', ['run', 'installer'], { cwd: ROOT, stdio: 'inherit', shell: isWin });

const exe = path.join(OUT, 'CyberDomeInstaller.exe');
const buf = fs.readFileSync(exe);
const tag = `v${version}`;
const feed = {
  version,
  released_at: new Date().toISOString(),
  notes: notes || `CyberDome ${version}`,
  page: `https://github.com/${UPDATE_REPO}/releases/tag/${tag}`,
  installer: {
    name: 'CyberDomeInstaller.exe',
    url: `https://github.com/${UPDATE_REPO}/releases/download/${tag}/CyberDomeInstaller.exe`,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    size: buf.length,
  },
};
const feedPath = path.join(OUT, 'latest.json');
fs.writeFileSync(feedPath, JSON.stringify(feed, null, 2) + '\n');
console.log(`> Wrote ${feedPath}`);

let gh = false;
try {
  execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' });
  gh = true;
} catch {
  /* not installed or not signed in */
}

if (gh) {
  execFileSync('gh', ['release', 'create', tag, exe, feedPath, '--repo', UPDATE_REPO, '--title', `CyberDome ${version}`, '--notes', feed.notes, '--latest'], { stdio: 'inherit' });
  console.log(`\nPublished ${tag}. Installed copies will offer it within a few hours, or right away from "Check for updates".`);
} else {
  console.log(`
GitHub CLI not available or not signed in, so nothing was uploaded.
Publish by hand:
  1. Open https://github.com/${UPDATE_REPO}/releases/new  (create the public repo first if needed)
  2. Tag: ${tag}   Title: CyberDome ${version}
  3. Attach both files:
       ${exe}
       ${feedPath}
  4. Publish and keep "Set as the latest release" ticked.`);
}
