'use strict';

// The application menu, built here so its structure is testable rather than
// buried in main.js.
//
// The shell replaces Electron's default menu, which means every standard role
// has to be re-declared: omit them and copy/paste, select-all and Cmd+Q quietly
// stop working. Keeping the template in one place lets a test (and a real
// Menu.buildFromTemplate harness) prove they are still present.

const UPDATE_MENU_ITEM_ID = 'check-for-updates';
// The tray only appears when there is something to do, so its first real entry
// is the action itself — that is the whole point of surfacing the signal.
const TRAY_UPDATE_ITEM_ID = 'tray-update';

function buildMenuTemplate({
  platform = process.platform,
  appName = 'DeepSeek Harness',
  updateLabel = '检查更新…',
  onCheckForUpdates,
} = {}) {
  const isMac = platform === 'darwin';

  // Always-present entry point for updates. Its label tracks the tracker, so an
  // available release is visible without waiting for a dialog.
  const updateItem = { id: UPDATE_MENU_ITEM_ID, label: updateLabel };
  if (typeof onCheckForUpdates === 'function') updateItem.click = onCheckForUpdates;

  return [
    ...(isMac
      ? [
          {
            label: appName,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              updateItem,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }]),
      ],
    },
    // Without a macOS-style application menu the entry would otherwise be
    // dropped entirely, so non-mac builds surface it under Help.
    ...(isMac ? [] : [{ label: '帮助', submenu: [updateItem] }]),
  ];
}

// Menu-bar (tray) dropdown. This exists because a Dock badge tells the user
// that an update exists without telling them how to act on it: the badge is a
// signal with no action attached. The tray icon *is* the action — one click on a
// visible menu-bar item leads straight to the update.
function buildTrayMenuTemplate({
  current,
  latest,
  checking = false,
  onUpdate,
  onOpenReleases,
  onCheckForUpdates,
  onQuit,
} = {}) {
  const items = [];
  if (latest) items.push({ label: `有新版本 ${latest}`, enabled: false });
  if (current) items.push({ label: `当前版本 ${current}`, enabled: false });
  // Without this the dropdown keeps claiming an update is ready while a check is
  // in flight, which is exactly how the entry looked broken before.
  if (checking) items.push({ label: '正在检查更新…', enabled: false });
  items.push({ type: 'separator' });

  const update = { id: TRAY_UPDATE_ITEM_ID, label: '立即更新…' };
  if (typeof onUpdate === 'function') update.click = onUpdate;
  update.enabled = !checking;
  items.push(update);

  if (typeof onOpenReleases === 'function') items.push({ label: '前往下载页', click: onOpenReleases });
  items.push({ type: 'separator' });

  if (typeof onCheckForUpdates === 'function') items.push({ label: '检查更新…', click: onCheckForUpdates });
  if (typeof onQuit === 'function') {
    items.push({ type: 'separator' });
    items.push({ label: '退出 DeepSeek Harness', click: onQuit });
  }
  return items;
}

module.exports = { UPDATE_MENU_ITEM_ID, TRAY_UPDATE_ITEM_ID, buildMenuTemplate, buildTrayMenuTemplate };
