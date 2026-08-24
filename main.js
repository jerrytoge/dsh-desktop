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

const { app, BrowserWindow, dialog, shell, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const semver = require('semver');
const { createDesktopServices } = require('./lib/desktop-services');
const { healProfileManifestsSync } = require('./lib/profile-manager');

const SMOKE = process.env.DSH_SMOKE === '1';
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
    return { current, latest, hasUpdate: semver.gt(latest, current) };
  } catch (err) {
    log('update check failed (ignored):', err && err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function promptUpdate(info) {
  if (!win || win.isDestroyed()) return;
  dialog
    .showMessageBox(win, {
      type: 'info',
      title: '发现新版本',
      message: 'DeepSeek Harness Desktop 有新版本可用',
      detail: `当前版本：${info.current}\n最新版本：${info.latest}\n\n可在 GitHub Releases 下载新版本。`,
      buttons: ['前往下载', '稍后'],
      defaultId: 0,
      cancelId: 1,
    })
    .then(({ response }) => {
      if (response === 0) shell.openExternal(RELEASES_PAGE);
    })
    .catch(() => {});
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

function ensureDesktopPluginFallback() {
  const packageDir = path.join(__dirname, 'packages', 'dsh-client-ui-settings-desktop');
  if (!fs.existsSync(path.join(packageDir, 'package.json'))) return false;
  const dshHome = path.resolve(process.env.DSH_HOME || path.join(app.getPath('home'), '.dsh'));
  const link = path.join(dshHome, 'profiles', 'node_modules', '@local', 'dsh-client-ui-settings-desktop');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  try {
    const stat = fs.lstatSync(link);
    if (!stat.isSymbolicLink()) throw new Error(`Desktop plugin fallback exists and is not a symlink: ${link}`);
    const current = fs.realpathSync(link);
    if (current === fs.realpathSync(packageDir)) return true;
    fs.unlinkSync(link);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  fs.symlinkSync(packageDir, link, 'junction');
  return true;
}

function startSidecar(port) {
  const { cmd, script } = resolveDsh();
  const desktopPatch = path.join(__dirname, 'desktop.cordis.patch.yml');
  const desktopPluginReady = ensureDesktopPluginFallback();

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
  // but a duplicate.
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
    env: { ...process.env, FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (d) => process.stdout.write(d.toString()));
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
    currentUrl = `http://${HOST}:${port}/`;
    sidecar = startSidecar(port);
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
    startWatchdogs();
    if (SMOKE) {
      smokeDone = true;
      log('SMOKE_OK');
      setTimeout(() => app.quit(), 500);
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
    currentUrl = `http://${HOST}:${port}/`;
    sidecar = startSidecar(port);
    await waitForHttp(currentUrl);
    createWindow(currentUrl);

    // Check GitHub Releases for a newer desktop build (non-blocking, silent
    // on failure). Skipped during smoke tests and when opted out.
    if (!UPDATE_CHECK_DISABLED && !SMOKE) {
      checkForUpdate().then((info) => {
        if (info && info.hasUpdate) promptUpdate(info);
      });
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

  app.whenReady().then(boot);

  // Closing the window also shuts down the sidecar: a wrapper should not leave
  // a headless server running after the user closes the UI.
  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', () => {
    quitting = true;
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
