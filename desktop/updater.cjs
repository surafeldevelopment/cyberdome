// CyberDome update checker for the desktop app.
//
// Every installed copy reads a small public feed (latest.json) published next to the installer
// on GitHub Releases. When the feed lists a newer version it asks the user:
//   Update now  ->  download the installer, verify its SHA-256, run it, close CyberDome
//   Remind me later  ->  ask again in 24 hours
//   Skip this version  ->  never ask about this version again (a later one still prompts)
// The check is a plain HTTPS GET with no identifiers or assessment data in it.
const { app, dialog, shell, Notification } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEFAULT_FEED = 'https://github.com/surafeldevelopment/cyberdome/releases/latest/download/latest.json';
const ALLOWED_HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const REMIND_AFTER_MS = 24 * 60 * 60 * 1000;

const statePath = () => path.join(app.getPath('userData'), 'update-state.json');
function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch {
    return {};
  }
}
function writeState(patch) {
  const next = { ...readState(), ...patch };
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(next, null, 2));
  } catch {
    /* best effort */
  }
  return next;
}

function feedUrl() {
  return process.env.CYBERDOME_UPDATE_URL || readState().feedUrl || DEFAULT_FEED;
}

/** Compare dotted versions numerically: 1.10.0 > 1.9.3. */
function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

function allowedUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && ALLOWED_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

async function fetchFeed() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(feedUrl(), { signal: ctrl.signal, headers: { accept: 'application/json', 'user-agent': `CyberDome/${app.getVersion()}` } });
    if (res.status === 404) return null; // nothing published yet
    if (!res.ok) throw new Error(`update feed returned HTTP ${res.status}`);
    const feed = await res.json();
    if (!feed || typeof feed.version !== 'string' || !feed.installer?.url || !/^[a-f0-9]{64}$/i.test(feed.installer.sha256 ?? '')) throw new Error('update feed is malformed');
    if (!allowedUrl(feed.installer.url)) throw new Error('update feed points to an unexpected download host');
    return feed;
  } finally {
    clearTimeout(t);
  }
}

async function download(feed, onProgress) {
  const res = await fetch(feed.installer.url, { redirect: 'follow', headers: { 'user-agent': `CyberDome/${app.getVersion()}` } });
  if (!res.ok || !res.body) throw new Error(`download failed (HTTP ${res.status})`);
  if (!allowedUrl(res.url)) throw new Error('download was redirected to an unexpected host');
  const total = Number(res.headers.get('content-length')) || feed.installer.size || 0;
  const dir = path.join(app.getPath('temp'), 'CyberDomeUpdate');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `CyberDomeInstaller-${feed.version.replace(/[^\w.-]/g, '')}.exe`);
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(file);
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    out.write(Buffer.from(value));
    got += value.length;
    if (total) onProgress(got / total);
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  const digest = hash.digest('hex');
  if (digest.toLowerCase() !== feed.installer.sha256.toLowerCase()) {
    fs.rmSync(file, { force: true });
    throw new Error('the downloaded installer did not match its published SHA-256, so it was deleted and not run');
  }
  return file;
}

/**
 * @param {{ getWindow: () => import('electron').BrowserWindow | null, iconPath: string, onQuitForUpdate: () => void, logError: (e: unknown) => void }} opts
 */
function createUpdater(opts) {
  let busy = false;
  let timer = null;

  const parent = () => {
    const w = opts.getWindow();
    return w && !w.isDestroyed() && w.isVisible() ? w : undefined;
  };

  async function installUpdate(feed) {
    const w = opts.getWindow();
    try {
      const file = await download(feed, (p) => w && !w.isDestroyed() && w.setProgressBar(p));
      w && !w.isDestroyed() && w.setProgressBar(-1);
      // Silent install (Windows still asks for permission), then the installer reopens CyberDome.
      spawn(file, ['/S', '/RELAUNCH'], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
      opts.onQuitForUpdate();
    } catch (e) {
      w && !w.isDestroyed() && w.setProgressBar(-1);
      opts.logError(e);
      const r = await dialog.showMessageBox(parent(), {
        type: 'error',
        title: 'CyberDome update',
        message: 'The update could not be installed.',
        detail: `${e?.message ?? e}\n\nYou can download the installer yourself from the releases page.`,
        buttons: ['Open releases page', 'Close'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (r.response === 0) shell.openExternal(feed.page || 'https://github.com/surafeldevelopment/cyberdome/releases/latest');
    }
  }

  async function prompt(feed) {
    const notes = String(feed.notes ?? '').trim().slice(0, 1500);
    const r = await dialog.showMessageBox(parent(), {
      type: 'info',
      title: 'CyberDome update',
      icon: opts.iconPath,
      message: `CyberDome ${feed.version} is available`,
      detail: `You have version ${app.getVersion()}.${notes ? `\n\nWhat's new:\n${notes}` : ''}\n\nYour assessment data is kept when you update.`,
      buttons: ['Update now', 'Remind me later', 'Skip this version'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (r.response === 0) await installUpdate(feed);
    else if (r.response === 1) writeState({ remindAfter: new Date(Date.now() + REMIND_AFTER_MS).toISOString() });
    else writeState({ skippedVersion: feed.version });
  }

  /** @param {{ manual?: boolean }} o  manual checks ignore "skip" and "remind later", and report "up to date". */
  async function check(o = {}) {
    if (busy) return;
    busy = true;
    try {
      const state = readState();
      if (!o.manual && state.autoCheck === false) return;
      writeState({ lastCheck: new Date().toISOString() });
      const feed = await fetchFeed();
      const isNewer = feed && newer(feed.version, app.getVersion());
      if (!isNewer) {
        if (o.manual)
          await dialog.showMessageBox(parent(), { type: 'info', title: 'CyberDome', message: 'CyberDome is up to date', detail: `You have the latest version (${app.getVersion()}).`, buttons: ['OK'], noLink: true });
        return;
      }
      if (!o.manual) {
        if (state.skippedVersion === feed.version) return;
        if (state.remindAfter && Date.parse(state.remindAfter) > Date.now()) return;
        // If the window is hidden in the tray, tell the user with a notification and ask when they open it.
        if (!parent() && Notification.isSupported()) {
          const n = new Notification({ title: `CyberDome ${feed.version} is available`, body: 'Click to review the update.', icon: opts.iconPath });
          n.on('click', () => {
            const w = opts.getWindow();
            if (w) { w.show(); w.focus(); }
            void prompt(feed);
          });
          n.show();
          return;
        }
      }
      await prompt(feed);
    } catch (e) {
      opts.logError(e);
      if (o.manual)
        await dialog.showMessageBox(parent(), { type: 'warning', title: 'CyberDome', message: 'Could not check for updates', detail: String(e?.message ?? e), buttons: ['OK'], noLink: true });
    } finally {
      busy = false;
    }
  }

  return {
    start() {
      setTimeout(() => void check(), 20_000);
      timer = setInterval(() => void check(), CHECK_EVERY_MS);
    },
    stop() {
      if (timer) clearInterval(timer);
    },
    check,
    autoCheckEnabled: () => readState().autoCheck !== false,
    setAutoCheck: (on) => writeState({ autoCheck: !!on }),
    status: () => ({ version: app.getVersion(), feed: feedUrl(), ...readState() }),
  };
}

module.exports = { createUpdater, newer, allowedUrl, DEFAULT_FEED };
