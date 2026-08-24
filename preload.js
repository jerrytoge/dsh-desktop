// Minimal preload: a secure bridge surface for future native integrations
// (host.openPath, native directory picker, notifications, tray).
//
// Runs with contextIsolation + sandbox enabled, so only the narrow
// contextBridge API below is visible to the page.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (method, payload) => ipcRenderer.invoke('dsh-desktop:invoke', { method, payload });

contextBridge.exposeInMainWorld('dshDesktop', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  plugins: {
    list: () => invoke('plugins.list'),
    checkUpdates: () => invoke('plugins.checkUpdates'),
    install: (spec) => invoke('plugins.install', { spec }),
    update: (name, version) => invoke('plugins.update', { name, version }),
    setEnabled: (name, enabled) => invoke('plugins.setEnabled', { name, enabled }),
    remove: (name) => invoke('plugins.remove', { name }),
    operation: (id) => invoke('operations.get', { id }),
  },
  commandLine: {
    status: () => invoke('command.status'),
    install: () => invoke('command.install'),
    repair: () => invoke('command.install'),
    remove: () => invoke('command.remove'),
  },
  sidecar: {
    restart: () => invoke('sidecar.restart'),
  },
});
