'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const MARKER = '# Managed by DeepSeek Harness Desktop';
const WRAPPER_VERSION = '1';

function targetPath(homeDir = os.homedir()) {
  if (!path.isAbsolute(homeDir) || homeDir === path.parse(homeDir).root || homeDir.includes('\0')) {
    throw Object.assign(new Error('Unsafe home directory'), { code: 'UNSAFE_HOME' });
  }
  return path.join(homeDir, '.local', 'bin', 'dsh');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function renderWrapper({ nodePath, dshEntry }) {
  return `#!/bin/sh\n${MARKER}\n# Wrapper-Version: ${WRAPPER_VERSION}\nNODE=${shellQuote(nodePath)}\nDSH=${shellQuote(dshEntry)}\nif [ ! -x "$NODE" ] || [ ! -f "$DSH" ]; then\n  echo "DeepSeek Harness Desktop is missing, damaged, or has moved. Open the app and repair the dsh command." >&2\n  exit 127\nfi\nunset NODE_OPTIONS NODE_PATH\nexec "$NODE" "$DSH" "$@"\n`;
}

async function lstatOptional(file) {
  try { return await fsp.lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function assertSafeDirectory(dir, { create = false } = {}) {
  if (create) await fsp.mkdir(dir, { recursive: true, mode: 0o755 });
  const stat = await lstatOptional(dir);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw Object.assign(new Error(`Unsafe command directory: ${dir}`), { code: 'UNSAFE_DIRECTORY' });
  }
  if (typeof stat.uid === 'number' && typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw Object.assign(new Error('Command directory is not owned by the current user'), { code: 'UNSAFE_OWNER' });
  }
  if ((stat.mode & 0o022) !== 0) {
    throw Object.assign(new Error('Command directory is group/world writable'), { code: 'UNSAFE_MODE' });
  }
}

function isManagedContent(content) {
  return content.startsWith(`#!/bin/sh\n${MARKER}\n# Wrapper-Version: `) && content.includes('\nexec "$NODE" "$DSH" "$@"\n');
}

async function inspectCommandEntry({ homeDir = os.homedir(), nodePath, dshEntry, env = process.env } = {}) {
  const file = targetPath(homeDir);
  const stat = await lstatOptional(file);
  const localBin = path.dirname(file);
  const pathEntries = String(env.PATH || '').split(path.delimiter).filter(Boolean).map((entry) => path.resolve(entry));
  const onPath = pathEntries.includes(path.resolve(localBin));
  if (!stat) return { path: file, state: 'absent', managed: false, onPath };
  if (stat.isSymbolicLink()) return { path: file, state: 'foreign-symlink', managed: false, onPath };
  if (!stat.isFile()) return { path: file, state: 'foreign-special', managed: false, onPath };
  const content = await fsp.readFile(file, 'utf8');
  if (!isManagedContent(content)) return { path: file, state: 'foreign-file', managed: false, onPath };
  const expected = nodePath && dshEntry ? renderWrapper({ nodePath, dshEntry }) : null;
  return { path: file, state: expected === null || content === expected ? 'managed-current' : 'managed-stale', managed: true, onPath };
}

async function installCommandEntry({ homeDir = os.homedir(), nodePath, dshEntry } = {}) {
  if (!path.isAbsolute(nodePath) || !path.isAbsolute(dshEntry)) throw Object.assign(new Error('Launcher paths must be absolute'), { code: 'INVALID_LAUNCHER' });
  const file = targetPath(homeDir);
  const dir = path.dirname(file);
  await assertSafeDirectory(path.dirname(dir), { create: true });
  await assertSafeDirectory(dir, { create: true });
  const status = await inspectCommandEntry({ homeDir, nodePath, dshEntry });
  if (!['absent', 'managed-current', 'managed-stale'].includes(status.state)) {
    throw Object.assign(new Error(`Refusing to replace existing ${status.state} at ${file}`), { code: 'COMMAND_CONFLICT', state: status.state });
  }
  const content = renderWrapper({ nodePath, dshEntry });
  if (status.state === 'managed-current') return { path: file, action: 'unchanged' };
  const temp = path.join(dir, `.dsh.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  let handle;
  try {
    handle = await fsp.open(temp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW || 0), 0o755);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close(); handle = null;
    await fsp.chmod(temp, 0o755);
    const current = await inspectCommandEntry({ homeDir, nodePath, dshEntry });
    if (status.state === 'absent' && current.state !== 'absent') throw Object.assign(new Error('Command destination changed during installation'), { code: 'COMMAND_RACE' });
    if (status.managed && !current.managed) throw Object.assign(new Error('Managed command changed during installation'), { code: 'COMMAND_RACE' });
    await fsp.rename(temp, file);
    return { path: file, action: status.state === 'absent' ? 'created' : 'updated' };
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fsp.unlink(temp).catch(() => {});
  }
}

async function removeCommandEntry({ homeDir = os.homedir() } = {}) {
  const status = await inspectCommandEntry({ homeDir });
  if (status.state === 'absent') return { path: status.path, action: 'absent' };
  if (!status.managed) throw Object.assign(new Error(`Refusing to remove ${status.state}`), { code: 'COMMAND_CONFLICT', state: status.state });
  await fsp.unlink(status.path);
  return { path: status.path, action: 'removed' };
}

module.exports = {
  MARKER,
  WRAPPER_VERSION,
  inspectCommandEntry,
  installCommandEntry,
  isManagedContent,
  removeCommandEntry,
  renderWrapper,
  shellQuote,
  targetPath,
};
