'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const semver = require('semver');
const yaml = require('js-yaml');

const WEB_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];
const PROFILE_NAME = 'web';
const SAFE_PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/i;
const CORDIS_PACKAGE = '@deepseek-ai/cordis';

function declaresCordisPlugin(pkg) {
  if (typeof pkg.dsh?.bundle?.patch === 'string') return false;
  const peers = pkg.peerDependencies && typeof pkg.peerDependencies === 'object' ? pkg.peerDependencies : {};
  const deps = pkg.dependencies && typeof pkg.dependencies === 'object' ? pkg.dependencies : {};
  return CORDIS_PACKAGE in peers || CORDIS_PACKAGE in deps || pkg.cordis != null;
}

async function readCordisPatch(profileDir) {
  const file = path.join(profileDir, 'cordis.patch.yml');
  try {
    const parsed = yaml.load(await fsp.readFile(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeCordisPatch(profileDir, entries) {
  const file = path.join(profileDir, 'cordis.patch.yml');
  const content = entries.length === 0 ? '[]\n' : `${yaml.dump(entries, { lineWidth: -1, noRefs: true })}\n`;
  await atomicWriteText(file, content);
}

async function atomicWriteText(file, content) {
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(temp, content, { mode: 0o600 });
  await fsp.rename(temp, file);
}

function cordisEnabledNames(entries) {
  const names = new Set();
  for (const entry of entries) {
    if (!entry || !Array.isArray(entry.insert)) continue;
    for (const row of entry.insert) if (row && typeof row.name === 'string') names.add(row.name);
  }
  return names;
}

function setCordisPlugin(entries, name, enabled) {
  const next = [];
  for (const entry of entries) {
    if (entry && Array.isArray(entry.insert)) {
      const rows = entry.insert.filter((row) => !row || row.name !== name);
      if (rows.length > 0) next.push({ ...entry, insert: rows });
    } else {
      next.push(entry);
    }
  }
  if (enabled) next.push({ insert: [{ id: name, name }] });
  return next;
}

function resolveDshHome(env = process.env) {
  return path.resolve(env.DSH_HOME || path.join(os.homedir(), '.dsh'));
}

function resolveProfileDir(env = process.env) {
  return path.join(resolveDshHome(env), 'profiles', PROFILE_NAME);
}

function classifySpec(spec) {
  if (/^git\+|^github:|\.git(?:#|$)/i.test(spec)) return 'git';
  if (/^file:/i.test(spec)) return 'file';
  if (/^link:/i.test(spec)) return 'link';
  if (/^(?:https?:).*\.(?:tgz|tar\.gz)(?:[?#]|$)/i.test(spec)) return 'tarball';
  return 'registry';
}

function gitRemote(spec) {
  const github = /^github:([^/#\s]+)\/([^#\s]+?)(?:#(.+))?$/i.exec(spec);
  if (github) return { url: `https://github.com/${github[1]}/${github[2]}.git`, ref: github[3] && !/^[a-f0-9]{40}$/i.test(github[3]) ? github[3] : 'HEAD' };
  const direct = /^(git\+?https:\/\/[^#\s]+?)(?:#(.+))?$/i.exec(spec);
  if (direct) return { url: direct[1].replace(/^git\+/, ''), ref: direct[2] && !/^[a-f0-9]{40}$/i.test(direct[2]) ? direct[2] : 'HEAD' };
  return null;
}

async function installedGitRevision(profileDir, name) {
  try {
    const lock = await fsp.readFile(path.join(profileDir, 'pnpm-lock.yaml'), 'utf8');
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const block = new RegExp(`(?:^|\\n) {6}${escaped}:\\n(?: {8}.*\\n){0,4}? {8}version: [^\\n]*?([a-f0-9]{40})(?:\\n|$)`, 'i').exec(lock);
    return block?.[1] || null;
  } catch {
    return null;
  }
}

function localSpecPath(profileDir, spec) {
  const match = /^(?:link|file):(.+)$/i.exec(spec);
  if (!match) return null;
  return path.resolve(profileDir, match[1]);
}

function validatePackageName(name) {
  if (typeof name !== 'string' || !SAFE_PACKAGE.test(name)) {
    throw Object.assign(new Error(`Invalid package name: ${JSON.stringify(name)}`), { code: 'INVALID_PACKAGE' });
  }
  return name;
}

function parseInstallSpec(spec) {
  if (typeof spec !== 'string' || !spec.trim() || /[\0\r\n]/.test(spec)) {
    throw Object.assign(new Error('Package spec must be a non-empty single line'), { code: 'INVALID_SPEC' });
  }
  const value = spec.trim();
  if (/^(?:file|link):|^(?:\.{1,2})(?:[\\/]|$)|^[\\/]/i.test(value)) {
    throw Object.assign(new Error('Local package specs are not enabled in this version'), { code: 'UNSUPPORTED_SPEC' });
  }
  let name;
  if (value.startsWith('@')) {
    const slash = value.indexOf('/');
    const versionAt = value.indexOf('@', slash + 1);
    name = versionAt === -1 ? value : value.slice(0, versionAt);
  } else {
    const versionAt = value.indexOf('@');
    name = versionAt === -1 ? value : value.slice(0, versionAt);
  }
  validatePackageName(name);
  return { name, spec: value, source: classifySpec(value) };
}

async function atomicWriteJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fsp.rename(temp, file);
}

async function ensureProfile(profileDir) {
  await fsp.mkdir(profileDir, { recursive: true, mode: 0o700 });
  const manifestPath = path.join(profileDir, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    await atomicWriteJson(manifestPath, {
      name: 'dsh-profile-web',
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [...WEB_BUNDLES] } },
    });
  }
  const patch = path.join(profileDir, 'cordis.patch.yml');
  if (!fs.existsSync(patch)) await fsp.writeFile(patch, '[]\n', { mode: 0o600 });
  const workspace = path.join(profileDir, 'pnpm-workspace.yaml');
  if (!fs.existsSync(workspace)) {
    await fsp.writeFile(workspace, 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n', { mode: 0o600 });
  }
}

async function readJson(file) {
  const raw = await fsp.readFile(file, 'utf8');
  return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
}

// Some published plugins ship a package.json with a UTF-8 BOM. Node's ESM
// resolver and DSH's own manifest reader use strict JSON.parse and crash on the
// BOM, so merely reading it in our code is not enough — the file on disk must be
// healed before DSH tries to load the plugin. Writing via a temp file + rename
// also breaks any pnpm hard link safely (the content-addressable store copy is
// left untouched).
async function stripBomFromFile(file) {
  let raw;
  try {
    raw = await fsp.readFile(file);
  } catch {
    return false;
  }
  if (raw.length < 3 || raw[0] !== 0xef || raw[1] !== 0xbb || raw[2] !== 0xbf) return false;
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(temp, raw.subarray(3), { mode: 0o600 });
  await fsp.rename(temp, file);
  return true;
}

function stripBomSync(file) {
  let raw;
  try {
    raw = fs.readFileSync(file);
  } catch {
    return false;
  }
  if (raw.length < 3 || raw[0] !== 0xef || raw[1] !== 0xbb || raw[2] !== 0xbf) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, raw.subarray(3), { mode: 0o600 });
  fs.renameSync(temp, file);
  return true;
}

// Heal BOM-prefixed manifests of every direct dependency before the sidecar
// (DSH) boots. DSH/Node parse these with strict JSON.parse, so a plugin shipped
// with a BOM would otherwise take the whole app down before our renderer ever
// gets a chance to inspect it. Best-effort: never throws.
function healProfileManifestsSync(profileDir) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
  } catch {
    return [];
  }
  const dependencies = manifest.dependencies && typeof manifest.dependencies === 'object' ? manifest.dependencies : {};
  const healed = [];
  for (const name of Object.keys(dependencies)) {
    const file = path.join(profileDir, 'node_modules', ...name.split('/'), 'package.json');
    try {
      if (stripBomSync(file)) healed.push(name);
    } catch {}
  }
  return healed;
}

async function packageInfo(profileDir, name, requestedSpec, bundles, cordisNames) {
  const manifestPath = path.join(profileDir, 'node_modules', ...name.split('/'), 'package.json');
  let installedVersion = null;
  let declaresBundle = false;
  let isCordisPlugin = false;
  let healed = false;
  try {
    healed = await stripBomFromFile(manifestPath);
    const pkg = await readJson(manifestPath);
    installedVersion = typeof pkg.version === 'string' ? pkg.version : null;
    declaresBundle = typeof pkg.dsh?.bundle?.patch === 'string';
    isCordisPlugin = declaresCordisPlugin(pkg);
  } catch {}
  const activeBundle = bundles.includes(name);
  const enabled = activeBundle || cordisNames.has(name);
  return {
    packageName: name,
    requestedSpec,
    source: classifySpec(requestedSpec),
    installedVersion,
    declaresBundle,
    isCordisPlugin,
    activeBundle,
    enabled,
    toggleable: declaresBundle || isCordisPlugin,
    healed,
    bundleOrder: bundles.includes(name) ? bundles.indexOf(name) : null,
  };
}

async function inspectProfile(profileDir) {
  await ensureProfile(profileDir);
  const manifest = await readJson(path.join(profileDir, 'package.json'));
  const dependencies = manifest.dependencies && typeof manifest.dependencies === 'object' ? manifest.dependencies : {};
  const bundles = Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : [];
  const cordisNames = cordisEnabledNames(await readCordisPatch(profileDir));
  const plugins = await Promise.all(Object.entries(dependencies).map(([name, spec]) => packageInfo(profileDir, name, String(spec), bundles, cordisNames)));
  return { profile: PROFILE_NAME, profileDir, plugins, checkedAt: new Date().toISOString() };
}

async function reconcileBundles(profileDir, { removed = [] } = {}) {
  const manifestPath = path.join(profileDir, 'package.json');
  const manifest = await readJson(manifestPath);
  const dependencies = manifest.dependencies && typeof manifest.dependencies === 'object' ? manifest.dependencies : {};
  const existing = Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : [];
  const personal = [];
  for (const [name, spec] of Object.entries(dependencies)) {
    const info = await packageInfo(profileDir, name, String(spec), existing, new Set());
    if (info.declaresBundle) personal.push(name);
  }
  const removedSet = new Set(removed);
  const next = [...existing.filter((name) => !removedSet.has(name) && !Object.hasOwn(dependencies, name)), ...personal];
  manifest.dsh = { ...(manifest.dsh || {}), profile: { ...(manifest.dsh?.profile || {}), bundles: [...new Set(next)] } };
  await atomicWriteJson(manifestPath, manifest);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

async function ensureRuntimeBin(runtimeBinDir, nodePath, pnpmEntry) {
  await fsp.mkdir(runtimeBinDir, { recursive: true, mode: 0o700 });
  const stat = await fsp.lstat(runtimeBinDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw Object.assign(new Error('Package-manager runtime bin is unsafe'), { code: 'UNSAFE_RUNTIME_BIN' });
  }
  const launchers = {
    node: `#!/bin/sh\nexec ${shellQuote(nodePath)} "$@"\n`,
    pnpm: `#!/bin/sh\nexec ${shellQuote(nodePath)} ${shellQuote(pnpmEntry)} "$@"\n`,
    pnpx: `#!/bin/sh\nexec ${shellQuote(nodePath)} ${shellQuote(pnpmEntry)} dlx "$@"\n`,
  };
  for (const [name, content] of Object.entries(launchers)) {
    const file = path.join(runtimeBinDir, name);
    const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
    await fsp.writeFile(temp, content, { mode: 0o700 });
    await fsp.chmod(temp, 0o700);
    await fsp.rename(temp, file);
  }
  return runtimeBinDir;
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const lines = [];
    const pending = { stdout: '', stderr: '' };
    const emit = (kind, text) => {
      if (!text) return;
      const line = { kind, text, at: new Date().toISOString() };
      lines.push(line);
      if (lines.length > 500) lines.shift();
      options.onLog?.(line);
    };
    const append = (kind, chunk) => {
      const parts = `${pending[kind]}${String(chunk)}`.split(/\r?\n/);
      pending[kind] = parts.pop() || '';
      for (const text of parts) emit(kind, text);
    };
    const flush = () => {
      emit('stdout', pending.stdout);
      emit('stderr', pending.stderr);
      pending.stdout = '';
      pending.stderr = '';
    };
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => { flush(); resolve({ code: code ?? 1, signal, lines }); });
  });
}

class PersonalPluginManager {
  constructor(options) {
    this.profileDir = options.profileDir || resolveProfileDir(options.env);
    this.nodePath = options.nodePath;
    this.pnpmEntry = options.pnpmEntry;
    this.env = options.env || process.env;
    this.runtimeBinDir = options.runtimeBinDir || path.join(resolveDshHome(this.env), 'desktop', 'runtime-bin');
    this.run = options.run || runProcess;
    this.mutation = Promise.resolve();
  }

  async list() { return inspectProfile(this.profileDir); }

  assertPackageManager() {
    if (!this.nodePath || !fs.existsSync(this.nodePath)) throw Object.assign(new Error('Bundled Node runtime is unavailable'), { code: 'NODE_MISSING' });
    if (!this.pnpmEntry || !fs.existsSync(this.pnpmEntry)) throw Object.assign(new Error('Bundled pnpm is unavailable; reinstall or rebuild Desktop'), { code: 'PNPM_MISSING' });
  }

  async pnpm(args, onLog, { needsRuntimeBin = true, cwd = this.profileDir } = {}) {
    this.assertPackageManager();
    await ensureProfile(this.profileDir);
    const inheritedPath = String(this.env.PATH || '').split(path.delimiter).filter(Boolean);
    const runtimeBinDir = needsRuntimeBin
      ? await ensureRuntimeBin(this.runtimeBinDir, this.nodePath, this.pnpmEntry)
      : null;
    const env = {
      ...this.env,
      PATH: [runtimeBinDir, '/usr/bin', '/bin', '/usr/sbin', '/sbin', ...inheritedPath].filter(Boolean).join(path.delimiter),
      NODE: this.nodePath,
      npm_execpath: this.pnpmEntry,
      npm_node_execpath: this.nodePath,
      npm_config_user_agent: 'pnpm/11.22.0 dsh-desktop',
      COREPACK_ENABLE_PROJECT_SPEC: '0',
      NODE_OPTIONS: '',
      NODE_PATH: '',
      FORCE_COLOR: '0',
    };
    const result = await this.run(this.nodePath, [this.pnpmEntry, ...args], { cwd, env, onLog });
    if (result.code !== 0) {
      const detail = result.lines.filter((line) => line.kind === 'stderr').map((line) => line.text).join(' · ');
      throw Object.assign(new Error(detail || `pnpm exited with code ${result.code}`), { code: 'PNPM_FAILED', result });
    }
    return result;
  }

  async checkGit(plugin, onLog) {
    const remote = gitRemote(plugin.requestedSpec);
    if (!remote) return { ...plugin, checkable: false, updateAvailable: false, reasonCode: 'UNSUPPORTED_GIT_SPEC', reason: '暂不支持检查此 Git 地址格式' };
    const installedRevision = await installedGitRevision(this.profileDir, plugin.packageName);
    if (!installedRevision) return { ...plugin, checkable: false, updateAvailable: false, reasonCode: 'GIT_REVISION_UNRESOLVED', reason: '无法从 pnpm lockfile 读取当前 Git 提交' };
    const result = await this.run('/usr/bin/git', ['ls-remote', remote.url, remote.ref], {
      cwd: path.dirname(this.nodePath), env: { ...this.env, GIT_TERMINAL_PROMPT: '0' }, onLog,
    });
    if (result.code !== 0) {
      const detail = result.lines.filter((line) => line.kind === 'stderr').map((line) => line.text).join(' · ');
      throw new Error(detail || `git ls-remote exited with code ${result.code}`);
    }
    const output = result.lines.filter((line) => line.kind === 'stdout').map((line) => line.text).join('\n');
    // Git's SHA is followed by a tab. Do not use `\b`: when output chunks split
    // inside the SHA, older runProcess emitted fragments and the word boundary
    // match could never recover the complete revision.
    const latestRevision = output.match(/(?:^|\s)([a-f0-9]{40})(?=\s|$)/im)?.[1] || null;
    if (!latestRevision) throw new Error('远端没有返回可识别的 Git 提交');
    return {
      ...plugin, checkable: true, installedRevision, latestRevision,
      updateAvailable: installedRevision.toLowerCase() !== latestRevision.toLowerCase(),
      updateKind: 'git', updateTarget: latestRevision,
    };
  }

  async checkLocal(plugin) {
    const sourceDir = localSpecPath(this.profileDir, plugin.requestedSpec);
    if (!sourceDir) return { ...plugin, checkable: false, updateAvailable: false, reasonCode: 'UNSUPPORTED_LOCAL_SPEC', reason: '无法解析本地插件路径' };
    try {
      const sourceManifest = await readJson(path.join(sourceDir, 'package.json'));
      const latestVersion = typeof sourceManifest.version === 'string' ? sourceManifest.version : null;
      if (!latestVersion) throw new Error('本地 package.json 未声明 version');
      const updateAvailable = semver.valid(latestVersion) && semver.valid(plugin.installedVersion)
        ? semver.gt(latestVersion, plugin.installedVersion)
        : latestVersion !== plugin.installedVersion;
      return { ...plugin, checkable: true, latestVersion, updateAvailable: Boolean(updateAvailable), updateKind: semver.diff(plugin.installedVersion, latestVersion) || 'local' };
    } catch (error) {
      throw new Error(`无法读取本地插件：${error.message}`);
    }
  }

  serialize(work) {
    const next = this.mutation.then(work, work);
    this.mutation = next.catch(() => {});
    return next;
  }

  async checkUpdates(onLog) {
    const snapshot = await this.list();
    const plugins = [];
    for (const plugin of snapshot.plugins) {
      if (plugin.source === 'git') {
        try { plugins.push(await this.checkGit(plugin, onLog)); }
        catch (error) { plugins.push({ ...plugin, checkable: false, updateAvailable: false, reasonCode: 'CHECK_FAILED', reason: `检查失败：${error.message}` }); }
        continue;
      }
      if (plugin.source === 'link' || plugin.source === 'file') {
        try { plugins.push(await this.checkLocal(plugin)); }
        catch (error) { plugins.push({ ...plugin, checkable: false, updateAvailable: false, reasonCode: 'CHECK_FAILED', reason: `检查失败：${error.message}` }); }
        continue;
      }
      if (plugin.source !== 'registry') {
        plugins.push({ ...plugin, checkable: false, updateAvailable: false, reasonCode: 'UNSUPPORTED_SOURCE', reason: `暂不支持自动检查 ${plugin.source} 来源的更新` });
        continue;
      }
      if (!plugin.installedVersion) {
        plugins.push({ ...plugin, checkable: false, updateAvailable: false, reasonCode: 'VERSION_UNRESOLVED', reason: '无法读取当前安装版本；可尝试重新安装或修复此插件' });
        continue;
      }
      try {
        // `pnpm view` is a read-only Registry request and does not execute package
        // scripts. Avoid touching $DSH_HOME/desktop/runtime-bin here: on macOS a
        // running App may not have permission to rewrite launchers created by a
        // differently signed/installed build, while direct bundled Node + pnpm is sufficient.
        const result = await this.pnpm(['view', plugin.packageName, 'version', '--json'], onLog, {
          needsRuntimeBin: false,
          // `pnpm view` may create a transient file in cwd. Use the app-owned
          // runtime directory rather than the user profile, which can be blocked
          // by macOS privacy/sandbox policy for an installed GUI application.
          cwd: path.dirname(this.nodePath),
        });
        const raw = result.lines.filter((line) => line.kind === 'stdout').map((line) => line.text).join('\n').trim();
        const parsed = JSON.parse(raw || 'null');
        const latestVersion = Array.isArray(parsed) ? parsed.at(-1) : parsed;
        const updateAvailable = semver.valid(latestVersion) && semver.valid(plugin.installedVersion)
          ? semver.gt(latestVersion, plugin.installedVersion) : latestVersion !== plugin.installedVersion;
        plugins.push({ ...plugin, checkable: true, latestVersion, updateAvailable: Boolean(updateAvailable), updateKind: semver.diff(plugin.installedVersion, latestVersion) });
      } catch (error) {
        plugins.push({ ...plugin, checkable: false, updateAvailable: false, reasonCode: 'CHECK_FAILED', reason: `检查失败：${error.message}` });
      }
    }
    return { ...snapshot, plugins, checkedAt: new Date().toISOString() };
  }

  install(spec, onLog) {
    const parsed = parseInstallSpec(spec);
    return this.serialize(async () => {
      const result = await this.pnpm(['add', parsed.spec, '--save-prod'], onLog);
      await reconcileBundles(this.profileDir);
      return { result, snapshot: await this.list(), restartRequired: true };
    });
  }

  update(name, targetVersion, onLog) {
    validatePackageName(name);
    return this.serialize(async () => {
      const snapshot = await this.list();
      const plugin = snapshot.plugins.find((item) => item.packageName === name);
      if (!plugin) throw Object.assign(new Error('Package is not a personal direct dependency'), { code: 'NOT_PERSONAL_PLUGIN' });
      let installSpec;
      if (plugin.source === 'registry') {
        // Resolve the dist-tag at mutation time instead of pinning the version
        // returned by an earlier cached update check. Registry versions can be
        // unpublished or dist-tags can move between checking and clicking Update.
        installSpec = `${name}@latest`;
      } else if (plugin.source === 'git') {
        if (targetVersion && !/^[a-f0-9]{40}$/i.test(targetVersion)) throw Object.assign(new Error('Target Git revision is invalid'), { code: 'INVALID_VERSION' });
        const remote = gitRemote(plugin.requestedSpec);
        installSpec = targetVersion && remote ? `${remote.url}#${targetVersion}` : plugin.requestedSpec;
      } else if (plugin.source === 'link' || plugin.source === 'file') {
        installSpec = plugin.requestedSpec;
      } else {
        throw Object.assign(new Error(`Updates are not supported for ${plugin.source} packages`), { code: 'UNSUPPORTED_SOURCE' });
      }
      const result = await this.pnpm(['add', installSpec, '--save-prod'], onLog);
      await reconcileBundles(this.profileDir);
      return { result, snapshot: await this.list(), restartRequired: true };
    });
  }

  setEnabled(name, enabled) {
    validatePackageName(name);
    if (typeof enabled !== 'boolean') throw Object.assign(new Error('Enabled state must be boolean'), { code: 'INVALID_ENABLED_STATE' });
    return this.serialize(async () => {
      if (WEB_BUNDLES.includes(name)) throw Object.assign(new Error('Official bundles cannot be changed here'), { code: 'OFFICIAL_BUNDLE' });
      const snapshot = await this.list();
      const plugin = snapshot.plugins.find((item) => item.packageName === name);
      if (!plugin) throw Object.assign(new Error('Package is not a personal direct dependency'), { code: 'NOT_PERSONAL_PLUGIN' });
      if (!plugin.toggleable) throw Object.assign(new Error('This package does not declare a DSH bundle or a Cordis plugin'), { code: 'NOT_TOGGLEABLE' });
      const wasEnabled = plugin.enabled;
      if (plugin.declaresBundle) {
        const manifestPath = path.join(this.profileDir, 'package.json');
        const manifest = await readJson(manifestPath);
        const existing = Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : [];
        const next = enabled ? [...new Set([...existing, name])] : existing.filter((item) => item !== name);
        manifest.dsh = { ...(manifest.dsh || {}), profile: { ...(manifest.dsh?.profile || {}), bundles: next } };
        await atomicWriteJson(manifestPath, manifest);
      } else {
        const entries = await readCordisPatch(this.profileDir);
        await writeCordisPatch(this.profileDir, setCordisPlugin(entries, name, enabled));
      }
      return { snapshot: await this.list(), restartRequired: wasEnabled !== enabled, enabled };
    });
  }

  remove(name, onLog) {
    validatePackageName(name);
    return this.serialize(async () => {
      const snapshot = await this.list();
      if (!snapshot.plugins.some((plugin) => plugin.packageName === name)) throw Object.assign(new Error('Package is not a personal direct dependency'), { code: 'NOT_PERSONAL_PLUGIN' });
      const result = await this.pnpm(['remove', name], onLog);
      await reconcileBundles(this.profileDir, { removed: [name] });
      await writeCordisPatch(this.profileDir, setCordisPlugin(await readCordisPatch(this.profileDir), name, false));
      return { result, snapshot: await this.list(), restartRequired: true };
    });
  }
}

module.exports = {
  PersonalPluginManager,
  classifySpec,
  declaresCordisPlugin,
  ensureProfile,
  ensureRuntimeBin,
  inspectProfile,
  parseInstallSpec,
  readCordisPatch,
  reconcileBundles,
  resolveDshHome,
  resolveProfileDir,
  runProcess,
  setCordisPlugin,
  stripBomFromFile,
  stripBomSync,
  healProfileManifestsSync,
  validatePackageName,
};
