// Builds the Windows desktop app (desktop/out/CyberDome) and its installer
// (desktop/out/CyberDomeInstaller.exe). Works from Linux, macOS or Windows:
// no Wine and no code signing. Needs NSIS (makensis) for the installer.
//   npm run installer        (from the repository root)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'out');
const STAGE = path.join(OUT, 'stage');
const APP_DIR = path.join(OUT, 'CyberDome');
const ELECTRON_VERSION = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8')).electronVersion.replace(/^[^\d]*/, '');
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = rootPkg.version || '1.0.0';

const step = (m) => console.log(`\n> ${m}`);
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const copy = (a, b) => fs.cpSync(a, b, { recursive: true });

// The installer is compiled with NSIS (makensis), available on Windows, macOS and Linux.
function findMakensis() {
  const candidates = process.platform === 'win32'
    ? ['makensis', 'C:\\Program Files (x86)\\NSIS\\makensis.exe', 'C:\\Program Files\\NSIS\\makensis.exe']
    : ['makensis'];
  for (const c of candidates) {
    try {
      execFileSync(c, ['-VERSION'], { stdio: 'ignore' });
      return c;
    } catch {
      /* try next */
    }
  }
  console.error('makensis (NSIS 3) was not found. Install it first:\n  Debian/Ubuntu: sudo apt-get install nsis\n  macOS:         brew install makensis\n  Windows:       https://nsis.sourceforge.io (then reopen the terminal)');
  process.exit(1);
}
const MAKENSIS = findMakensis();

// Optional Authenticode signing. Set CYBERDOME_SIGN_PFX (path to a code-signing .pfx from a
// certificate authority) and CYBERDOME_SIGN_PASSWORD. Uses signtool on Windows, osslsigncode elsewhere.
function sign(file) {
  const pfx = process.env.CYBERDOME_SIGN_PFX;
  if (!pfx) return false;
  const pass = process.env.CYBERDOME_SIGN_PASSWORD ?? '';
  const ts = process.env.CYBERDOME_SIGN_TIMESTAMP || 'http://timestamp.digicert.com';
  if (process.platform === 'win32') {
    execFileSync('signtool', ['sign', '/f', pfx, '/p', pass, '/fd', 'sha256', '/tr', ts, '/td', 'sha256', '/d', 'CyberDome Command Center', file], { stdio: 'inherit' });
  } else {
    const tmp = `${file}.signed`;
    execFileSync('osslsigncode', ['sign', '-pkcs12', pfx, '-pass', pass, '-h', 'sha256', '-n', 'CyberDome Command Center', '-ts', ts, '-in', file, '-out', tmp], { stdio: 'inherit' });
    fs.renameSync(tmp, file);
  }
  return true;
}


rm(OUT);
fs.mkdirSync(STAGE, { recursive: true });

step('Building the web interface');
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });

step('Bundling the server');
const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
await esbuild.build({
  entryPoints: [path.join(ROOT, 'server', 'desktop.ts')],
  outfile: path.join(STAGE, 'server.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['better-sqlite3', 'electron'],
  define: { 'import.meta.url': '__cdImportMetaUrl' },
  banner: { js: "const __cdImportMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  logLevel: 'warning',
});

step('Staging app files');
copy(path.join(HERE, 'main.cjs'), path.join(STAGE, 'main.cjs'));
copy(path.join(HERE, 'updater.cjs'), path.join(STAGE, 'updater.cjs'));
copy(path.join(HERE, 'preload.cjs'), path.join(STAGE, 'preload.cjs'));
copy(path.join(HERE, 'assets'), path.join(STAGE, 'assets'));
copy(path.join(ROOT, 'dist'), path.join(STAGE, 'dist'));
copy(path.join(ROOT, 'samples'), path.join(STAGE, 'samples'));
fs.writeFileSync(
  path.join(STAGE, 'package.json'),
  JSON.stringify({ name: 'cyberdome', productName: 'CyberDome', version: VERSION, description: 'CyberDome Command Center', main: 'main.cjs' }, null, 2),
);

step(`Downloading Electron ${ELECTRON_VERSION} for Windows x64`);
const { downloadArtifact } = require('@electron/get');
const zip = await downloadArtifact({ version: ELECTRON_VERSION, platform: 'win32', arch: 'x64', artifactName: 'electron' });
fs.mkdirSync(APP_DIR, { recursive: true });
// unzip on Linux/macOS; Windows 10+ ships bsdtar, which reads zip files.
if (process.platform === 'win32') execFileSync('tar', ['-xf', zip, '-C', APP_DIR]);
else execFileSync('unzip', ['-q', zip, '-d', APP_DIR]);

step('Assembling CyberDome.exe');
fs.renameSync(path.join(APP_DIR, 'electron.exe'), path.join(APP_DIR, 'CyberDome.exe'));
rm(path.join(APP_DIR, 'resources', 'default_app.asar'));
for (const f of fs.readdirSync(path.join(APP_DIR, 'locales'))) if (f !== 'en-US.pak') rm(path.join(APP_DIR, 'locales', f));
const asar = require('@electron/asar');
await asar.createPackage(STAGE, path.join(APP_DIR, 'resources', 'app.asar'));

step('Setting the icon and version info');
const ResEdit = require('resedit');
const exePath = path.join(APP_DIR, 'CyberDome.exe');
const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(HERE, 'assets', 'icon.ico')));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const iconId = groups.length ? groups[0].id : 1;
const lang = groups.length ? groups[0].lang : 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, iconId, lang, ico.icons.map((i) => i.data));
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
const [maj, min, pat] = VERSION.split('.').map((n) => Number(n) || 0);
vi.setFileVersion(maj, min, pat, 0, 1033);
vi.setProductVersion(maj, min, pat, 0, 1033);
vi.setStringValues({ lang: 1033, codepage: 1200 }, {
  FileDescription: 'CyberDome Command Center',
  ProductName: 'CyberDome',
  InternalName: 'CyberDome',
  OriginalFilename: 'CyberDome.exe',
  CompanyName: 'CyberDome (NWIT 246 project)',
  LegalCopyright: 'Built on Electron (MIT)',
});
vi.outputToResourceEntries(res.entries);
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
if (sign(exePath)) console.log('  Signed CyberDome.exe');

rm(STAGE);

step('Building the installer');
const SETUP = path.join(OUT, `CyberDomeInstaller.exe`);
execFileSync(MAKENSIS, [
  '-V2',
  `-DAPP_VERSION=${VERSION}`,
  `-DSRC_DIR=${APP_DIR}`,
  `-DOUT_FILE=${SETUP}`,
  `-DICON=${path.join(HERE, 'assets', 'icon.ico')}`,
  `-DBMP_DIR=${path.join(HERE, 'installer')}`,
  path.join(HERE, 'installer', 'cyberdome.nsi'),
], { stdio: 'inherit' });
if (sign(SETUP)) console.log('  Signed the installer');
else console.log('  Installer is unsigned (set CYBERDOME_SIGN_PFX to sign it).');
console.log(`\nDone:\n  App folder: ${APP_DIR}\n  Installer:  ${SETUP}`);
