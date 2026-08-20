// Minimal preload: a secure bridge surface for future native integrations
// (host.openPath, native directory picker, notifications, tray).
//
// Runs with contextIsolation + sandbox enabled, so only the narrow
// contextBridge API below is visible to the page.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('dshDesktop', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
