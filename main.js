// dsh-desktop: minimal Electron shell for the DeepSeek Harness web GUI.
//
// The host (`dsh web`) runs as a sidecar Node process; this shell only
// manages its lifecycle and hosts the window. Keeping the harness in its own
// process means none of its native modules (sharp, node-pty, koffi, ripgrep)
// need an Electron-ABI rebuild.
//
// Sidecar resolution order (first match wins):
//   1. DSH_BIN                  — explicit path (or command) to the dsh entry
//   2. local @deepseek-ai/dsh   — entry resolved from its package.json `bin`
//   3. node_modules/.bin/dsh    — local bin shim
//   4. dsh on PATH

const { app, BrowserWindow, dialog, shell, ipcMain, Menu, Notification, Tray, nativeImage } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const semver = require('semver');
const { createDesktopServices } = require('./lib/desktop-services');
const { readTierSync: readCommunicationPolicyTierSync } = require('./lib/communication-policy-settings');
const { healProfileManifestsSync } = require('./lib/profile-manager');
const { pickDmgAsset, verifyFile, downloadAsset } = require('./lib/update-download');
const { CANCEL_URL, formatBytes, formatProgress, buildProgressHtml } = require('./lib/update-progress');
const { createUpdateTracker } = require('./lib/update-state');
const { UPDATE_MENU_ITEM_ID, buildMenuTemplate, buildTrayMenuTemplate } = require('./lib/update-menu');
const { createTrayIcon } = require('./lib/tray-icon');

const SMOKE = process.env.DSH_SMOKE === '1';
// Must precede requestSingleInstanceLock: never signal/focus the user's app.
if (SMOKE && process.env.DSH_SMOKE_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.DSH_SMOKE_USER_DATA));
  app.setPath('sessionData', path.resolve(process.env.DSH_SMOKE_USER_DATA));
  app.setPath('home', path.resolve(process.env.HOME));
}

async function waitForSmokeUi(contents) {
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    const ready = await contents.executeJavaScript(`(async () => {
      const plugin = document.querySelector('style[data-plugin-css="dsh-desktop-settings"]');
      const controls = [...document.querySelectorAll('button, input, [role="button"]')]
        .some(el => el.getBoundingClientRect().width > 0);
      if (!plugin || !controls || !document.body.innerText.trim() || !window.dshDesktop) return false;
      const result = await window.dshDesktop.communicationPolicy.get();
      return result && result.ok === true;
    })()`);
    if (ready) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('UI/plugin/IPC readiness deadline exceeded');
}
const HOST = process.env.DSH_HOST || '127.0.0.1';
const PORT_OVERRIDE = process.env.DSH_PORT ? Number(process.env.DSH_PORT) : undefined;

/** @type {BrowserWindow | null} */
let win = null;
/** @type {import('node:child_process').ChildProcess | null} */
let sidecar = null;
const intentionallyStoppedSidecars = new WeakSet();
let quitting = false;
let currentUrl = null;
let smokeDone = false;

// Log to console AND to a diagnostics file. GUI launches route console output
// to the OS log (not a terminal), so the file is what we can actually read back
// after a white-screen.
let diagFile = null;
function diag(level, ...parts) {
  try {
    if (!diagFile) {
      const dir = path.join(app.getPath('userData'), 'logs');
      fs.mkdirSync(dir, { recursive: true });
      diagFile = path.join(dir, 'dsh-desktop.log');
    }
    fs.appendFileSync(diagFile, `[${new Date().toISOString()}] ${level} ${parts.join(' ')}\n`);
  } catch {}
}
const log = (...a) => { diag('INFO', ...a); console.log('[dsh-desktop]', ...a); };
const fatal = (...a) => { diag('ERROR', ...a); console.error('[dsh-desktop]', ...a); };

// ── sidecar resolution ─────────────────────────────────────────────────────

// Resolve the dsh entry point from the locally installed package's `bin`
// field instead of hardcoding a file path, so an upstream directory-layout
// change (e.g. lib/ → dist/) doesn't require touching this shell.
function resolveLocalDshEntry() {
  const pkgJson = path.join(__dirname, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
  if (!fs.existsSync(pkgJson)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
    const bin = manifest && manifest.bin;
    const rel =
      typeof bin === 'string' ? bin :
      bin && typeof bin === 'object' ? (bin.dsh || Object.values(bin)[0]) :
      null;
    if (typeof rel !== 'string') return null;
    const entry = path.join(path.dirname(pkgJson), rel);
    return fs.existsSync(entry) ? entry : null;
  } catch {
    return null;
  }
}

function resolveDsh() {
  const explicit = process.env.DSH_BIN;
  if (explicit) return { cmd: explicit, script: null };

  const localEntry = resolveLocalDshEntry();
  if (localEntry) return { cmd: null, script: localEntry };

  const localShim = path.join(__dirname, 'node_modules', '.bin', 'dsh');
  if (fs.existsSync(localShim)) return { cmd: localShim, script: null };

  return { cmd: 'dsh', script: null };
}

// The Node binary that runs the sidecar script. In a packaged app there is no
// system `node` on PATH, so use the Node we ship in Resources/node (see the
// electron-builder `extraResources` config). Dev falls back to `node` on PATH.
function resolveNode() {
  if (process.env.DSH_NODE) return process.env.DSH_NODE;
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'node', 'bin', 'node');
    if (fs.existsSync(bundled)) return bundled;
    fatal('packaged app is missing its bundled Node at', bundled);
  }
  return 'node';
}

// ── app update check ────────────────────────────────────────────────────────

// Detects whether a newer desktop release exists on GitHub Releases and
// prompts once. The app version is read from package.json (kept in sync with
// the bundled harness version via Renovate). Opt-out with DSH_UPDATE_CHECK=0;
// any network error is logged and ignored.
const UPDATE_CHECK_DISABLED = ['0', 'false'].includes(String(process.env.DSH_UPDATE_CHECK || '').toLowerCase());
// Re-check while the app stays open (a window left running for days should still
// notice a release). Clamped so a bad env value cannot hammer the GitHub API.
const UPDATE_INTERVAL_MS = (() => {
  const raw = Number(process.env.DSH_UPDATE_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 6 * 3600 * 1000;
  return Math.max(raw, 60 * 1000);
})();
// Tick coarsely instead of sleeping for hours: a missed tick during system
// sleep still re-evaluates on wake, because isDue() compares timestamps.
const UPDATE_TICK_MS = Math.min(UPDATE_INTERVAL_MS, 15 * 60 * 1000);
const updateTracker = createUpdateTracker({ intervalMs: UPDATE_INTERVAL_MS });
const GITHUB_API = (process.env.DSH_GITHUB_API || 'https://api.github.com').replace(/\/+$/, '');
const REPO = process.env.DSH_REPO || 'jerrytoge/dsh-desktop';
const RELEASES_PAGE = process.env.DSH_UPDATE_URL || `https://github.com/${REPO}/releases`;

function getAppVersion() {
  const pkgJson = path.join(__dirname, 'package.json');
  if (!fs.existsSync(pkgJson)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgJson, 'utf8')).version || null;
  } catch {
    return null;
  }
}

async function checkForUpdate() {
  const current = getAppVersion();
  if (!current) return null;
  const url = `${GITHUB_API}/repos/${REPO}/releases/latest`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // tag_name is e.g. "v0.1.0-rc.9-12" (harness version + build number).
    // Compare the full string: a larger build number on the SAME harness
    // version means an app-only stability release, which also counts as newer.
    const latest = (data && data.tag_name || '').replace(/^v/, '');
    if (!latest) return null;
    return {
      current,
      latest,
      hasUpdate: semver.gt(latest, current),
      releaseUrl: data.html_url || RELEASES_PAGE,
      assets: Array.isArray(data.assets) ? data.assets : [],
    };
  } catch (err) {
    log('update check failed (ignored):', err && err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── assisted update (download + verify + open) ─────────────────────────────
//
// Full self-install is intentionally out of scope: macOS auto-update runs
// through Squirrel.Mac, which requires a Developer ID signature this
// prototype does not have. Instead the shell downloads the release .dmg,
// verifies GitHub's published sha256 digest, and opens it so the user only
// has to drag the app across.

let updateDownloadAbort = null;

function updateDownloadDir() {
  return path.join(app.getPath('userData'), 'updates');
}

// A small dedicated window, because the Dock progress bar alone was invisible
// feedback: with the Dock hidden (or simply not watched) the app looked frozen
// for the whole multi-minute download.
function createUpdateProgressWindow(version, onCancel) {
  const progressWin = new BrowserWindow({
    width: 460,
    height: 196,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: '正在下载更新',
    parent: win && !win.isDestroyed() ? win : undefined,
    show: false,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  let userCancelled = false;
  let dismissed = false;
  const requestCancel = () => {
    if (userCancelled || dismissed) return;
    userCancelled = true;
    onCancel();
  };

  progressWin.webContents.on('will-navigate', (event, url) => {
    // The page has no preload/IPC; a cancel is just a navigation we intercept.
    if (String(url).startsWith(CANCEL_URL)) {
      event.preventDefault();
      requestCancel();
    }
  });
  // Closing the window counts as cancelling too.
  progressWin.on('closed', () => {
    if (!dismissed) requestCancel();
  });
  progressWin.once('ready-to-show', () => progressWin.show());
  progressWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildProgressHtml({ version }))}`);

  return {
    paint(data) {
      if (dismissed || progressWin.isDestroyed()) return;
      progressWin.webContents
        .executeJavaScript(`window.__setProgress(${JSON.stringify(data)})`)
        .catch(() => {});
    },
    close() {
      dismissed = true;
      if (!progressWin.isDestroyed()) progressWin.close();
    },
  };
}

async function offerDownloadedImage(file, summary) {
  const { response } = await dialog
    .showMessageBox(win, {
      type: 'info',
      title: '更新已下载',
      message: '安装包已下载并通过完整性校验',
      detail: `将打开磁盘映像，把「DeepSeek Harness」拖入「应用程序」即可完成更新。\n\n${summary}`,
      buttons: ['打开磁盘映像', '在访达中显示', '稍后'],
      defaultId: 0,
      cancelId: 2,
    })
    .catch(() => ({ response: 2 }));
  if (response === 0) {
    // openPath mounts the .dmg — exactly the manual step this replaces.
    const failure = await shell.openPath(file).catch(() => 'open failed');
    if (failure) shell.showItemInFolder(file);
  } else if (response === 1) {
    shell.showItemInFolder(file);
  }
}

async function pruneOldDownloads(dir, keepName) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((name) => name !== keepName && (name.endsWith('.dmg') || name.endsWith('.part')))
      .map((name) => fs.promises.rm(path.join(dir, name), { force: true }).catch(() => {}))
  );
}

async function runUpdateDownload(info, asset) {
  const dir = updateDownloadDir();
  const dest = path.join(dir, asset.name);
  const expectedSize = Number(asset.size);
  const expectedDigest = asset.digest;
  let progress = null;
  try {
    // A previous run may have already fetched a still-valid artefact; retrying
    // the mount should not cost another ~170MB.
    const existing = await verifyFile(dest, { expectedSize, expectedDigest });
    if (existing.ok) {
      await offerDownloadedImage(dest, `版本：${info.latest}`);
      return;
    }

    updateDownloadAbort = new AbortController();
    progress = createUpdateProgressWindow(info.latest, () => {
      log('update download cancelled by user');
      if (updateDownloadAbort) updateDownloadAbort.abort();
    });

    const startedAt = Date.now();
    let lastPaint = 0;
    const onProgress = ({ received, total }) => {
      const now = Date.now();
      if (now - lastPaint < 200 && received < total) return;
      lastPaint = now;
      progress.paint({ phase: '正在下载更新…', ...formatProgress({ received, total, startedAt }) });
      if (win && !win.isDestroyed()) {
        win.setProgressBar(total > 0 ? Math.min(received / total, 1) : 2);
      }
    };

    if (win && !win.isDestroyed()) win.setProgressBar(0);
    progress.paint({ phase: '正在下载更新…', percent: 0, detail: '正在连接…' });
    await downloadAsset({
      url: asset.browser_download_url,
      dest,
      expectedSize,
      expectedDigest,
      onProgress,
      signal: updateDownloadAbort.signal,
    });
    progress.paint({ phase: '下载完成，正在校验…', percent: 100, detail: formatBytes(expectedSize) });
    await pruneOldDownloads(dir, asset.name);
    if (win && !win.isDestroyed()) win.setProgressBar(-1);
    progress.close();
    await offerDownloadedImage(dest, `版本：${info.latest}｜大小：${formatBytes(expectedSize)}`);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      log('update download aborted');
      return;
    }
    log('update download failed:', err && err.message);
    if (progress) progress.close();
    const { response } = await dialog
      .showMessageBox(win, {
        type: 'error',
        title: '下载失败',
        message: '无法下载更新',
        detail: String((err && err.message) || err),
        buttons: ['前往下载页', '关闭'],
        defaultId: 0,
        cancelId: 1,
      })
      .catch(() => ({ response: 1 }));
    if (response === 0) shell.openExternal(info.releaseUrl || RELEASES_PAGE);
  } finally {
    if (progress) progress.close();
    updateDownloadAbort = null;
    if (win && !win.isDestroyed()) win.setProgressBar(-1);
  }
}

async function promptUpdate(info) {
  if (!win || win.isDestroyed()) return;
  // Assisted download only makes sense where a .dmg can be opened.
  const asset = process.platform === 'darwin' ? pickDmgAsset(info.assets, process.arch) : null;
  const buttons = asset ? ['下载并安装', '前往下载页', '稍后'] : ['前往下载页', '稍后'];
  const detail = asset
    ? `当前版本：${info.current}\n最新版本：${info.latest}`
    : `当前版本：${info.current}\n最新版本：${info.latest}\n\n可在 GitHub Releases 下载新版本。`;
  const { response } = await dialog
    .showMessageBox(win, {
      type: 'info',
      title: '发现新版本',
      message: 'DeepSeek Harness Desktop 有新版本可用',
      detail,
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
    })
    .catch(() => ({ response: buttons.length - 1 }));
  if (asset && response === 0) return runUpdateDownload(info, asset);
  if (response === (asset ? 1 : 0)) shell.openExternal(info.releaseUrl || RELEASES_PAGE);
}

// ── persistent update entry + periodic checks ──────────────────────────────

let updateTray = null;

function setUpdateBadge() {
  // Dock badge is the passive half of the entry: it stays visible after the
  // dialog is dismissed, so an available update cannot be silently forgotten.
  try {
    if (process.platform === 'darwin' && app.dock) app.dock.setBadge(updateTracker.badge());
  } catch (err) {
    log('dock badge failed (ignored):', err && err.message);
  }
}

function refreshUpdateMenu() {
  const item = Menu.getApplicationMenu()?.getMenuItemById(UPDATE_MENU_ITEM_ID);
  if (item) item.label = updateTracker.menuLabel();
}

// The Dock badge says "something is available" but offers nothing to click.
// The tray is the same signal, made actionable: it appears in the menu bar only
// when there is an update, and one click opens a menu whose default entry runs
// the update. It disappears again once the app is up to date.
function syncUpdateTray() {
  if (process.platform !== 'darwin') return;
  const { hasUpdate, latest, current, info, status } = updateTracker.state;

  if (!hasUpdate) {
    if (updateTray) {
      updateTray.destroy();
      updateTray = null;
    }
    return;
  }

  try {
    if (!updateTray) {
      updateTray = new Tray(createTrayIcon(nativeImage));
      updateTray.setToolTip('DeepSeek Harness 有新版本');
    }
    updateTray.setContextMenu(
      Menu.buildFromTemplate(
        buildTrayMenuTemplate({
          current,
          latest,
          checking: status === 'checking',
          onUpdate: () => {
            Promise.resolve(openUpdateEntry()).catch((err) => log('update prompt failed:', err && err.message));
          },
          onOpenReleases: () => shell.openExternal((info && info.releaseUrl) || RELEASES_PAGE),
          onCheckForUpdates: () =>
            runUpdateCheck({ manual: true }).catch((err) => log('manual update check failed:', err && err.message)),
          onQuit: () => app.quit(),
        })
      )
    );
  } catch (err) {
    // A menu-bar icon is a nicety; never let it take down the shell.
    log('update tray failed (ignored):', err && err.message);
    updateTray = null;
  }
}

function buildApplicationMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildMenuTemplate({
        platform: process.platform,
        appName: app.name,
        updateLabel: updateTracker.menuLabel(),
        onCheckForUpdates: () => {
          // Acts when a release is already known, otherwise checks.
          Promise.resolve(openUpdateEntry()).catch((err) =>
            log('manual update check failed:', err && err.message)
          );
        },
      })
    )
  );
}

// Clicking the persistent entry must always produce a visible outcome.
// When a release is already known this acts on it directly instead of spending
// a network round trip on a check whose result the user already knows — that
// path used to end in silence, which made the entry look broken.
function openUpdateEntry() {
  const action = updateTracker.clickAction();
  if (action === 'update') {
    updateTracker.markNotified();
    return promptUpdate(updateTracker.state.info);
  }
  if (action === 'wait') return undefined;
  return runUpdateCheck({ manual: true });
}

async function runUpdateCheck({ manual = false } = {}) {
  if (updateTracker.state.status === 'checking') return;
  updateTracker.markChecking();
  refreshUpdateMenu();
  syncUpdateTray();

  let info = null;
  try {
    info = await checkForUpdate();
  } catch (err) {
    log('update check threw (ignored):', err && err.message);
  }

  const { shouldPrompt, becameAvailable } = updateTracker.record(info);
  refreshUpdateMenu();
  setUpdateBadge();
  syncUpdateTray();

  if (!info) {
    // Only a user-initiated check deserves an error; a periodic failure is
    // logged and retried on the next tick.
    if (manual) await dialog.showMessageBox(win, { type: 'warning', title: '检查更新', message: '无法检查更新', detail: '请稍后重试，或前往 GitHub Releases 查看。' }).catch(() => {});
    return;
  }

  if (manual && !info.hasUpdate) {
    await dialog.showMessageBox(win, { type: 'info', title: '检查更新', message: '当前已是最新版本', detail: `版本：${info.current}` }).catch(() => {});
    return;
  }

  // A manual check always answers. Suppressing the dialog when the version was
  // already announced is right for periodic checks, but wrong for a click: the
  // user just asked for the update and must not be met with silence.
  if (shouldPrompt || manual) {
    updateTracker.markNotified();
    await promptUpdate(info);
    return;
  }

  // Already told the user about this version: rely on the badge and menu, but
  // reach out once when the update first appears while the window is in the
  // background, so an open app is not silently stuck on an old build.
  if (becameAvailable && win && !win.isDestroyed() && !win.isFocused() && Notification.isSupported()) {
    try {
      const notice = new Notification({ title: 'DeepSeek Harness 有新版本', body: `${info.latest}（当前 ${info.current}）` });
      notice.on('click', () => {
        if (win && !win.isDestroyed()) {
          win.show();
          win.focus();
        }
      });
      notice.show();
    } catch (err) {
      log('update notification failed (ignored):', err && err.message);
    }
  }
}

function startPeriodicUpdateChecks() {
  const timer = setInterval(() => {
    if (updateTracker.isDue()) {
      runUpdateCheck().catch((err) => log('periodic update check failed:', err && err.message));
    }
  }, UPDATE_TICK_MS);
  // Never hold the event loop open on account of the update timer.
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

// ── readiness / port helpers ───────────────────────────────────────────────

function pickPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, HOST, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForHttp(url, timeoutMs = 45000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.setTimeout(1500, () => req.destroy());
      req.once('error', () => {
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(`timed out waiting for ${url}`));
        }
        setTimeout(probe, 250);
      });
    };
    probe();
  });
}

// ── sidecar lifecycle ──────────────────────────────────────────────────────

// `dsh web` prints the authenticated root URL (carrying the process launch
// token) as `dsh web: <href>` on stdout. The web server refuses the bare
// origin with 401 ("dsh web authentication required") unless the browser opens
// the token-bearing URL first, so the shell must capture and load that URL
// rather than the bare `http://127.0.0.1:<port>/` it binds.
let sidecarRootUrl = null;
let sidecarUrlResolve = null;
let sidecarUrlPromise = null;

function resetSidecarUrl() {
  sidecarRootUrl = null;
  sidecarUrlPromise = new Promise((resolve) => { sidecarUrlResolve = resolve; });
}
resetSidecarUrl();

function waitForSidecarUrl(timeoutMs = 30000) {
  if (sidecarRootUrl) return Promise.resolve(sidecarRootUrl);
  let timer;
  return Promise.race([
    sidecarUrlPromise,
    new Promise((_r, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out waiting for dsh web to print its URL (${timeoutMs}ms)`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function onSidecarGone(err) {
  if (quitting) return;
  fatal('sidecar gone:', err && err.message ? err.message : err);
  if (win && !win.isDestroyed()) {
    dialog.showErrorBox(
      'DeepSeek Harness stopped',
      String((err && err.message) || err)
    );
  }
  app.quit();
}

// Symlink every local plugin package (packages/*) into the profile's
// node_modules/@local so the sidecar can resolve the `@local/*` rows that
// desktop.cordis.patch.yml inserts. Returns false when there is nothing to
// link, so callers can skip the patch overlay entirely.
function ensureDesktopPluginFallback() {
  const packagesDir = path.join(__dirname, 'packages');
  const dshHome = path.resolve(process.env.DSH_HOME || path.join(app.getPath('home'), '.dsh'));
  const localDir = path.join(dshHome, 'profiles', 'node_modules', '@local');
  let linked = 0;
  if (fs.existsSync(packagesDir)) {
    for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const packageDir = path.join(packagesDir, entry.name);
      if (!fs.existsSync(path.join(packageDir, 'package.json'))) continue;
      const link = path.join(localDir, entry.name);
      fs.mkdirSync(path.dirname(link), { recursive: true });
      try {
        const stat = fs.lstatSync(link);
        if (!stat.isSymbolicLink()) {
          throw new Error(`Desktop plugin fallback exists and is not a symlink: ${link}`);
        }
        // Reuse the link only when it resolves to this bundle's package dir.
        // A stale/broken symlink (realpath throws ENOENT) or one pointing
        // elsewhere must be replaced, otherwise `symlinkSync` below hits EEXIST.
        try {
          if (fs.realpathSync(link) === fs.realpathSync(packageDir)) {
            linked += 1;
            continue;
          }
        } catch {
          // broken link: fall through to unlink + recreate.
        }
        fs.unlinkSync(link);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      fs.symlinkSync(packageDir, link, 'junction');
      linked += 1;
    }
  }
  return linked > 0;
}

function startSidecar(port) {
  const { cmd, script } = resolveDsh();
  const desktopPatch = path.join(__dirname, 'desktop.cordis.patch.yml');
  const desktopPluginReady = ensureDesktopPluginFallback();
  // Each sidecar start issues a fresh launch token, so reset the captured URL.
  resetSidecarUrl();

  // Heal any BOM-prefixed plugin manifest before DSH boots: Node/DSH parse
  // package.json with strict JSON.parse, so a plugin shipped with a UTF-8 BOM
  // would crash the sidecar on the very first import.
  try {
    const profileDir = path.resolve(process.env.DSH_HOME || path.join(app.getPath('home'), '.dsh'), 'profiles', 'web');
    const healed = healProfileManifestsSync(profileDir);
    if (healed.length) log('healed BOM manifests:', healed.join(', '));
  } catch (error) {
    log('heal BOM manifests skipped:', error && error.message ? error.message : error);
  }

  // A script entry (bundled bin.js) is run through the resolved Node;
  // a command/shim entry (shebang) is spawned directly.
  //
  // `--no-open` stops `dsh web` from handing the URL off to the system's
  // default browser — this shell already shows the page in its own
  // BrowserWindow, so the second browser tab it would otherwise open is nothing
  // but a duplicate. `dsh web` prints the token-bearing root URL to stdout by
  // default (printUrl=true), so this shell captures it to load the
  // authenticated origin rather than the bare one.
  const argv0 = script ? resolveNode() : cmd;
  const webArgs = ['web'];
  if (desktopPluginReady && fs.existsSync(desktopPatch)) webArgs.push('--patch', desktopPatch);
  webArgs.push('--port', String(port), '--no-open');
  const args = script ? [script, ...webArgs] : webArgs;

  log('spawn sidecar:', argv0, args.join(' '));

  // Default workspace root: the user's home. Override with DSH_CWD.
  const cwd = process.env.DSH_CWD || app.getPath('home');

  const child = spawn(argv0, args, {
    cwd,
    env: { ...process.env, FORCE_COLOR: '1', DSH_DESKTOP_COMMUNICATION_POLICY_TIER: readCommunicationPolicyTierSync(process.env) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (d) => {
    const text = d.toString();
    process.stdout.write(text);
    const match = text.match(/dsh web:\s+(http:\/\/\S+)/);
    if (match) {
      const url = match[1].replace(/\s+\(LAN:.*$/, '');
      if (url && !sidecarRootUrl) {
        sidecarRootUrl = url;
        sidecarUrlResolve(url);
      }
    }
  });
  child.stderr.on('data', (d) => process.stderr.write(d.toString()));

  child.once('error', (err) => onSidecarGone(err));
  child.once('exit', (code, signal) => {
    log('sidecar exited', { code, signal });
    if (sidecar === child) sidecar = null;
    if (!quitting && !intentionallyStoppedSidecars.has(child)) {
      onSidecarGone(new Error(`dsh exited (code ${code}, signal ${signal})`));
    }
  });

  return child;
}

function killSidecar() {
  if (!sidecar) return;
  const c = sidecar;
  sidecar = null;
  intentionallyStoppedSidecars.add(c);
  try {
    c.kill('SIGTERM');
  } catch {}
  const t = setTimeout(() => {
    try {
      c.kill('SIGKILL');
    } catch {}
  }, 3000);
  c.once('exit', () => clearTimeout(t));
}

// ── recovery ────────────────────────────────────────────────────────────────
// A blank page or dead renderer should self-heal instead of requiring the user
// to quit and relaunch. Reload first; if the sidecar is unreachable, restart it.

let blankTimer = null;
let recoverCount = 0;
let recoverWindowStart = 0;

function recover(reason) {
  if (quitting || SMOKE) return;
  const now = Date.now();
  if (now - recoverWindowStart > 120000) {
    recoverWindowStart = now;
    recoverCount = 0;
  }
  recoverCount++;
  log('recover:', reason, `(attempt ${recoverCount})`);
  if (recoverCount > 5) {
    fatal('recover: giving up after repeated failures:', reason);
    dialog.showErrorBox('界面加载异常', '页面多次自动恢复失败，请退出应用后重新打开。');
    return;
  }
  if (win && !win.isDestroyed() && currentUrl) {
    win.loadURL(currentUrl).catch(() => {});
  }
}

async function recoverSidecar(reason, requested = false) {
  if (quitting || SMOKE) return;
  log('recover: restarting sidecar —', reason);
  try {
    killSidecar();
    const port = PORT_OVERRIDE || (await pickPort());
    sidecar = startSidecar(port);
    const printedUrl = await waitForSidecarUrl();
    currentUrl = printedUrl || `http://${HOST}:${port}/`;
    await waitForHttp(currentUrl);
    if (requested && win && !win.isDestroyed()) await win.loadURL(currentUrl);
    else recover('sidecar restarted');
  } catch (err) {
    fatal('recover: sidecar restart failed:', err && err.message);
    throw err;
  }
}

// Periodic health checks: detect a blank page (JS-level white screen) and a
// sidecar whose process is alive but no longer serving HTTP.
function startWatchdogs() {
  if (blankTimer) clearInterval(blankTimer);
  let blankStreak = 0;
  let sidecarDownStreak = 0;
  blankTimer = setInterval(async () => {
    if (quitting || !win || win.isDestroyed()) return;

    try {
      const n = await win.webContents.executeJavaScript(
        'typeof document !== "undefined" && document.body ? document.body.innerText.trim().length : -1'
      );
      if (n === 0) {
        blankStreak++;
        if (blankStreak >= 2) {
          blankStreak = 0;
          recover('blank page');
        }
      } else {
        blankStreak = 0;
      }
    } catch {}

    if (currentUrl && sidecar) {
      const req = http.get(currentUrl, (res) => {
        res.resume();
        sidecarDownStreak = 0;
      });
      req.on('error', () => {
        sidecarDownStreak++;
        if (sidecarDownStreak >= 2) {
          sidecarDownStreak = 0;
          recoverSidecar('sidecar unreachable');
        }
      });
      req.setTimeout(3000, () => req.destroy());
    }
  }, 10000);
}

// ── window ─────────────────────────────────────────────────────────────────

function createWindow(url) {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'DeepSeek Harness',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.on('did-finish-load', () => {
    log('READY', url);
    if (!SMOKE) startWatchdogs();
    if (SMOKE) {
      waitForSmokeUi(win.webContents).then(() => {
        smokeDone = true;
        log('SMOKE_OK');
        app.quit();
      }).catch(error => {
        fatal('SMOKE_FAIL:', error.message);
        killSidecar();
        app.exit(1);
      });
    }
  });

  win.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (!isMainFrame || quitting) return;
    if (SMOKE) {
      killSidecar();
      app.exit(1);
      return;
    }
    if (code === -3) return; // ERR_ABORTED: superseded by a recovery reload
    recover(`page load failed (${code} ${desc})`);
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    if (quitting) return;
    recover('renderer gone: ' + (details && details.reason));
  });

  win.on('unresponsive', () => recover('window unresponsive'));

  // Renderer console warnings/errors → diagnostics log (for white screens).
  win.webContents.on('console-message', (_e, ...args) => {
    const d = (args.length === 1 && args[0] && typeof args[0] === 'object')
      ? args[0]
      : { level: args[0], message: args[1], lineNumber: args[2], sourceId: args[3] };
    const lv = d && d.level;
    if (lv === 'error' || lv === 'warning' || lv === 2 || lv === 3) {
      log('renderer console', d.message, `(${d.sourceId || ''}:${d.lineNumber || ''})`);
    }
  });

  // External links (if any) open in the system browser, not inside the shell.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });

  win.on('closed', () => {
    win = null;
    if (blankTimer) {
      clearInterval(blankTimer);
      blankTimer = null;
    }
  });

  win.loadURL(url);
}

// ── Desktop companion IPC ──────────────────────────────────────────────────

let desktopServices = null;

function registerDesktopIpc() {
  desktopServices = createDesktopServices({
    appDir: __dirname,
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
    nodePath: resolveNode(),
    env: process.env,
    homeDir: app.getPath('home'),
    onRestart: () => recoverSidecar('requested by Desktop settings', true),
  });
  ipcMain.handle('dsh-desktop:invoke', async (event, request) => {
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) {
      return { ok: false, error: { code: 'UNTRUSTED_CALLER', message: 'Desktop API is restricted to the main application frame' } };
    }
    const senderUrl = new URL(event.senderFrame.url);
    if (senderUrl.protocol !== 'http:' || senderUrl.hostname !== HOST || senderUrl.port !== String(new URL(currentUrl).port)) {
      return { ok: false, error: { code: 'UNTRUSTED_ORIGIN', message: 'Desktop API call came from an unexpected origin' } };
    }
    if (!request || typeof request.method !== 'string' || request.payload !== undefined && (typeof request.payload !== 'object' || request.payload === null)) {
      return { ok: false, error: { code: 'INVALID_REQUEST', message: 'Malformed Desktop API request' } };
    }
    return desktopServices.invoke(request.method, request.payload);
  });
}

// ── boot ───────────────────────────────────────────────────────────────────

async function boot() {
  let port;
  try {
    if (!desktopServices) registerDesktopIpc();
    port = PORT_OVERRIDE || (await pickPort());
    sidecar = startSidecar(port);
    // Load the token-bearing URL `dsh web` prints, not the bare origin: the
    // web server answers the bare origin with 401 (auth required).
    const printedUrl = await waitForSidecarUrl();
    currentUrl = printedUrl || `http://${HOST}:${port}/`;
    await waitForHttp(currentUrl);
    createWindow(currentUrl);

    // First update check, plus the periodic re-check that keeps a long-lived
    // window aware of new releases. Skipped during smoke tests and when opted out.
    if (!UPDATE_CHECK_DISABLED && !SMOKE) {
      runUpdateCheck().catch((err) => log('update check failed (ignored):', err && err.message));
      startPeriodicUpdateChecks();
    }

    // Smoke watchdog: if the page never reports ready, fail instead of hanging.
    if (SMOKE) {
      setTimeout(() => {
        if (!smokeDone) {
          fatal('SMOKE_FAIL: no READY within timeout');
          killSidecar();
          app.exit(1);
        }
      }, 45000);
    }
  } catch (err) {
    fatal('boot failed:', err);
    killSidecar();
    if (!SMOKE) {
      dialog.showErrorBox(
        'DeepSeek Harness failed to start',
        String((err && err.message) || err)
      );
    }
    app.exit(1);
  }
}

// ── app lifecycle ──────────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      if (process.platform === 'darwin') app.focus({ steal: true });
    }
  });

  app.whenReady().then(() => {
    // The menu carries the always-present update entry, so it must exist before
    // the user can interact with the window.
    buildApplicationMenu();
    return boot();
  });

  // Closing the window also shuts down the sidecar: a wrapper should not leave
  // a headless server running after the user closes the UI.
  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', () => {
    quitting = true;
    // Drop an in-flight update download instead of leaving a stale .part file.
    if (updateDownloadAbort) updateDownloadAbort.abort();
    // A menu-bar icon outliving the app would be an orphan in the menu bar.
    if (updateTray) {
      updateTray.destroy();
      updateTray = null;
    }
    killSidecar();
  });

  // Graceful shutdown on signal (e.g. `kill <pid>`): replace SIGTERM/SIGINT's
  // default "terminate now" so the sidecar gets its own SIGTERM and exits
  // cleanly instead of being orphaned.
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => app.quit());
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && sidecar && currentUrl) {
      createWindow(currentUrl);
    }
  });
}
