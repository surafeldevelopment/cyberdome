// CyberDome desktop shell (Electron). Runs the same local server in-process on 127.0.0.1 and
// shows it in a native window. Closing the window keeps CyberDome in the system tray so
// automatic scans can still run; "Quit" from the tray stops everything.
const { app, BrowserWindow, Tray, Menu, shell, dialog, nativeImage, Notification, ipcMain } = require('electron');
const { createUpdater } = require('./updater.cjs');
const path = require('node:path');
const fs = require('node:fs');

app.setAppUserModelId('CyberDome.CommandCenter');
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

const HERE = __dirname;
const startHidden = process.argv.includes('--hidden');
// Local, non-synced app data (not Documents, which OneDrive often syncs to the cloud):
// evidence must never leave this computer automatically.
process.env.CYBERDOME_DATA_DIR ||= path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'CyberDome', 'data');
process.env.CYBERDOME_DIST_DIR ||= path.join(HERE, 'dist');
process.env.CYBERDOME_SAMPLES_DIR ||= path.join(HERE, 'samples');
process.env.NODE_ENV = 'production';

let win = null;
let tray = null;
let server = null;
let quitting = false;
let trayHintShown = false;
let updater = null;
const iconPath = path.join(HERE, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

function logError(err) {
  try {
    fs.mkdirSync(process.env.CYBERDOME_DATA_DIR, { recursive: true });
    fs.appendFileSync(path.join(process.env.CYBERDOME_DATA_DIR, 'desktop.log'), `[${new Date().toISOString()}] ${err && err.stack ? err.stack : err}\n`);
  } catch {
    /* ignore */
  }
}
process.on('uncaughtException', logError);
process.on('unhandledRejection', logError);

function isInternal(url) {
  return server && url.startsWith(server.url + '/') || (server && url === server.url);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 660,
    backgroundColor: '#050605',
    title: 'CyberDome',
    icon: iconPath,
    show: false,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true, preload: path.join(HERE, 'preload.cjs') },
  });
  win.removeMenu();
  win.loadURL(server.url);
  win.once('ready-to-show', () => {
    if (!startHidden) win.show();
  });
  // Links to the outside world open in the normal browser; nothing else may navigate the app away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) return { action: 'allow', overrideBrowserWindowOptions: { backgroundColor: '#050605', autoHideMenuBar: true, icon: iconPath } };
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (isInternal(url)) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r'))) win.webContents.reload();
  });
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!trayHintShown && Notification.isSupported()) {
      trayHintShown = true;
      new Notification({ title: 'CyberDome is still running', body: 'It stays in the system tray so automatic scans can run. Right-click the tray icon and choose Quit to stop it.', icon: iconPath }).show();
    }
  });
}

function show() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function buildTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('CyberDome Command Center');
  const login = () => app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
  const menu = () =>
    Menu.buildFromTemplate([
      { label: 'Open CyberDome', click: show },
      { type: 'separator' },
      {
        label: 'Start with Windows (in the tray)',
        type: 'checkbox',
        checked: login(),
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] });
          tray.setContextMenu(menu());
        },
      },
      { label: 'Open data folder', click: () => shell.openPath(process.env.CYBERDOME_DATA_DIR) },
      { type: 'separator' },
      { label: `Version ${app.getVersion()}`, enabled: false },
      { label: 'Check for updates…', click: () => updater && updater.check({ manual: true }) },
      {
        label: 'Check for updates automatically',
        type: 'checkbox',
        checked: updater ? updater.autoCheckEnabled() : true,
        click: (item) => {
          updater && updater.setAutoCheck(item.checked);
          tray.setContextMenu(menu());
        },
      },
      { type: 'separator' },
      { label: 'Quit CyberDome', click: () => { quitting = true; app.quit(); } },
    ]);
  tray.setContextMenu(menu());
  tray.on('click', show);
  tray.on('double-click', show);
}

app.on('second-instance', show);
app.on('window-all-closed', (e) => e.preventDefault());

app.on('before-quit', (e) => {
  quitting = true;
  if (server && !server.closing) {
    e.preventDefault();
    server.closing = true;
    server.close().finally(() => app.exit(0));
  }
});

app.whenReady().then(async () => {
  try {
    const { startDesktopServer } = require('./server.cjs');
    server = await startDesktopServer(4646);
  } catch (err) {
    logError(err);
    dialog.showErrorBox('CyberDome could not start', `${err && err.message ? err.message : err}\n\nDetails were written to ${path.join(process.env.CYBERDOME_DATA_DIR, 'desktop.log')}.`);
    app.exit(1);
    return;
  }
  updater = createUpdater({
    getWindow: () => win,
    iconPath,
    logError,
    onQuitForUpdate: () => {
      quitting = true;
      app.quit();
    },
  });
  ipcMain.handle('cyberdome:update-status', () => updater.status());
  ipcMain.handle('cyberdome:check-updates', () => updater.check({ manual: true }));
  ipcMain.handle('cyberdome:set-auto-update', (_e, on) => {
    updater.setAutoCheck(!!on);
    if (tray) buildTrayMenuRefresh();
    return updater.status();
  });
  buildTray();
  createWindow();
  updater.start();
});

function buildTrayMenuRefresh() {
  // Rebuild the tray so its checkbox matches a change made in Settings.
  if (!tray) return;
  tray.destroy();
  buildTray();
}
