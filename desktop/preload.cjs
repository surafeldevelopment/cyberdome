// Exposes a tiny, fixed API to the CyberDome window: version and update controls only.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cyberdomeDesktop', {
  updateStatus: () => ipcRenderer.invoke('cyberdome:update-status'),
  checkForUpdates: () => ipcRenderer.invoke('cyberdome:check-updates'),
  setAutoUpdate: (on) => ipcRenderer.invoke('cyberdome:set-auto-update', !!on),
});
