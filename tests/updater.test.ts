import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';

/**
 * The desktop updater runs inside Electron. Here Electron, child_process.spawn and fetch are
 * replaced with fakes so the decision logic (prompt, remind later, skip, hash check) is tested.
 */
const req = createRequire(import.meta.url);
let tmp: string;
let dialogAnswers: number[];
let dialogs: any[];
let spawned: any[];
let quit: number;
const origLoad = (Module as any)._load;

function fakeElectron() {
  return {
    app: { getVersion: () => '1.1.0', getPath: (k: string) => path.join(tmp, k) },
    dialog: {
      showMessageBox: async (_w: unknown, o: any) => {
        dialogs.push(o);
        return { response: dialogAnswers.shift() ?? 1 };
      },
    },
    shell: { openExternal: () => undefined },
    Notification: { isSupported: () => false },
  };
}

function load() {
  delete req.cache[req.resolve('../desktop/updater.cjs')];
  return req('../desktop/updater.cjs');
}

function feedFor(bytes: Buffer, version = '1.2.0', sha?: string) {
  return {
    version,
    notes: 'Faster scans',
    installer: { url: `https://github.com/surafeldevelopment/cyberdome-releases/releases/download/v${version}/CyberDomeInstaller.exe`, sha256: sha ?? crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length },
  };
}

function stubFetch(feed: unknown, bytes: Buffer) {
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.endsWith('latest.json')) return new Response(JSON.stringify(feed), { status: 200 });
    const res = new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-length': String(bytes.length) } });
    Object.defineProperty(res, 'url', { value: url });
    return res;
  });
}

describe('desktop updater', () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-upd-'));
    dialogAnswers = [];
    dialogs = [];
    spawned = [];
    quit = 0;
    (Module as any)._load = function (request: string, ...rest: unknown[]) {
      if (request === 'electron') return fakeElectron();
      if (request === 'node:child_process') return { spawn: (...a: unknown[]) => (spawned.push(a), { unref() {} }) };
      return origLoad.call(this, request, ...rest);
    };
  });
  afterEach(() => {
    (Module as any)._load = origLoad;
    vi.unstubAllGlobals();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const make = () =>
    load().createUpdater({ getWindow: () => null, iconPath: '', logError: () => undefined, onQuitForUpdate: () => quit++ });

  it('compares versions numerically and only trusts GitHub download hosts', () => {
    const { newer, allowedUrl } = load();
    expect(newer('1.10.0', '1.9.3')).toBe(true);
    expect(newer('1.1.0', '1.1.0')).toBe(false);
    expect(newer('v2.0.0', '1.99.99')).toBe(true);
    expect(allowedUrl('https://github.com/a/b/releases/download/v1/x.exe')).toBe(true);
    expect(allowedUrl('http://github.com/a/b')).toBe(false);
    expect(allowedUrl('https://evil.example/x.exe')).toBe(false);
  });

  it('asks with Update now / Remind me later / Skip this version, and honors each choice', async () => {
    const bytes = Buffer.from('synthetic installer bytes');
    stubFetch(feedFor(bytes), bytes);
    const u = make();
    dialogAnswers = [1]; // remind me later
    await u.check();
    expect(dialogs[0].buttons).toEqual(['Update now', 'Remind me later', 'Skip this version']);
    expect(dialogs[0].message).toMatch(/1\.2\.0 is available/);
    await u.check();
    expect(dialogs).toHaveLength(1); // reminder window not passed yet

    const u2 = make();
    fs.writeFileSync(path.join(tmp, 'userData', 'update-state.json'), JSON.stringify({}));
    dialogAnswers = [2]; // skip this version
    await u2.check();
    await u2.check();
    expect(dialogs).toHaveLength(2);
    dialogAnswers = [1];
    await u2.check({ manual: true }); // a manual check still shows it
    expect(dialogs).toHaveLength(3);
  });

  it('downloads, verifies SHA-256, runs the installer silently and quits', async () => {
    const bytes = Buffer.from('synthetic installer bytes');
    stubFetch(feedFor(bytes), bytes);
    dialogAnswers = [0];
    await make().check();
    expect(spawned).toHaveLength(1);
    expect(spawned[0][1]).toEqual(['/S', '/RELAUNCH']);
    expect(fs.readFileSync(spawned[0][0]).equals(bytes)).toBe(true);
    expect(quit).toBe(1);
  });

  it('refuses an installer whose hash does not match', async () => {
    const bytes = Buffer.from('synthetic installer bytes');
    stubFetch(feedFor(bytes, '1.2.0', 'a'.repeat(64)), bytes);
    dialogAnswers = [0, 1];
    await make().check();
    expect(spawned).toHaveLength(0);
    expect(quit).toBe(0);
    expect(dialogs[1].message).toMatch(/could not be installed/);
    expect(dialogs[1].detail).toMatch(/SHA-256/);
  });

  it('says up to date on a manual check when nothing newer exists', async () => {
    const bytes = Buffer.from('x');
    stubFetch(feedFor(bytes, '1.1.0'), bytes);
    dialogAnswers = [0];
    await make().check({ manual: true });
    expect(dialogs[0].message).toMatch(/up to date/);
    expect(spawned).toHaveLength(0);
  });
});
