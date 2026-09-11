#!/usr/bin/env node
// Explicit opt-in only: launches the supplied .app, never a replacement dev server.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export function smokeEnv(root, inherited = process.env) {
  const env = Object.fromEntries(Object.entries(inherited).filter(([key]) =>
    !/^(DSH_|ELECTRON_|NODE_|NPM_CONFIG_|npm_config_|PNPM_|XDG_|DYLD_)/.test(key)));
  return { ...env, HOME: path.join(root, 'home'), DSH_HOME: path.join(root, 'dsh'),
    DSH_CWD: path.join(root, 'home'), DSH_SMOKE: '1', DSH_UPDATE_CHECK: '0',
    DSH_SMOKE_USER_DATA: path.join(root, 'electron'),
    TMPDIR: path.join(root, 'tmp'), XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_CACHE_HOME: path.join(root, 'cache'), PATH: '/usr/bin:/bin:/usr/sbin:/sbin' };
}

export function inspectBundle(appPath) {
  const resources = path.join(path.resolve(appPath), 'Contents', 'Resources');
  const appDir = path.join(resources, 'app');
  const manifest = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  const require = createRequire(path.join(appDir, 'package.json'));
  // Resolve the actual runtime graph, not just the top-level manifest's presence.
  for (const name of Object.keys(manifest.dependencies || {})) {
    const dependency = JSON.parse(fs.readFileSync(path.join(appDir, 'node_modules', name, 'package.json'), 'utf8'));
    if (dependency.main || dependency.exports) require.resolve(name);
  }
  const dshManifestPath = path.join(appDir, 'node_modules/@deepseek-ai/dsh/package.json');
  const dsh = JSON.parse(fs.readFileSync(dshManifestPath, 'utf8'));
  const bin = typeof dsh.bin === 'string' ? dsh.bin : dsh.bin?.dsh;
  if (!bin) throw new Error('Packaged Harness has no dsh bin entry');
  const executable = path.join(path.resolve(appPath), 'Contents/MacOS', manifest.productName);
  for (const file of [executable, path.join(resources, 'node/bin/node')]) fs.accessSync(file, fs.constants.X_OK);
  for (const file of [path.join(appDir, manifest.main), path.resolve(path.dirname(dshManifestPath), bin),
    path.join(appDir, 'preload.js'), path.join(appDir, 'desktop.cordis.patch.yml'),
    path.join(appDir, 'packages/dsh-client-ui-settings-desktop/lib/client.js'),
    path.join(appDir, 'packages/dsh-agent-communication-policy/lib/index.js')]) fs.accessSync(file);
  return { executable, version: dsh.version };
}

export async function runSmoke(appPath, { timeoutMs = 120000, platform = process.platform,
  spawnImpl = spawn, kill = process.kill.bind(process), inspect = inspectBundle,
  inherited = process.env, graceMs = 1000 } = {}) {
  if (platform !== 'darwin') throw new Error('Packaged smoke requires macOS');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid timeout');
  const { executable, version } = inspect(appPath);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-packaged-smoke-'));
  const env = smokeEnv(root, inherited);
  for (const key of ['HOME', 'DSH_HOME', 'DSH_SMOKE_USER_DATA', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME'])
    fs.mkdirSync(env[key], { recursive: true });
  let child, timer, output = '', interrupted;
  const signalGroup = signal => {
    if (!child?.pid) return;
    try { kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const onSignal = () => interrupted?.(new Error('Smoke interrupted'));
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  try {
    // Sidecar spawn in main.js is NOT detached; it inherits this isolated group.
    child = spawnImpl(executable, [], { env, cwd: env.HOME, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      interrupted = reject;
      timer = setTimeout(() => reject(new Error(`Smoke deadline exceeded (${timeoutMs}ms)`)), timeoutMs);
      const capture = chunk => { output = (output + chunk.toString()).slice(-1024 * 1024); };
      child.stdout.on('data', capture); child.stderr.on('data', capture);
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (code === 0 && /\[dsh-desktop\] SMOKE_OK(?:\r?\n|$)/.test(output)) resolve();
        else reject(new Error(`Packaged smoke failed (exit=${code}, signal=${signal}, readiness=${output.includes('SMOKE_OK')})`));
      });
    });
    return { version, output };
  } catch (error) {
    error.message += `\n${output}`;
    throw error;
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
    try {
      signalGroup('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, graceMs));
      signalGroup('SIGKILL'); // Also after success: clean surviving sidecar/helpers.
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [appPath, timeout] = process.argv.slice(2);
  if (!appPath) { console.error('Usage: node scripts/smoke-packaged.mjs /path/to/DeepSeek\\ Harness.app [timeout-ms]'); process.exitCode = 1; }
  else runSmoke(appPath, { timeoutMs: timeout === undefined ? 120000 : Number(timeout) })
    .then(result => console.log(`Packaged smoke passed: Harness ${result.version}`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
