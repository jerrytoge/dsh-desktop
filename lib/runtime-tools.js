'use strict';

const fs = require('node:fs');
const path = require('node:path');

function resolvePackageBin(packageJsonPath, preferredName) {
  const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const bin = manifest.bin;
  const rel = typeof bin === 'string' ? bin : bin && typeof bin === 'object' ? (bin[preferredName] || Object.values(bin)[0]) : null;
  if (typeof rel !== 'string') throw Object.assign(new Error(`${manifest.name || packageJsonPath} declares no executable`), { code: 'BIN_MISSING' });
  const root = fs.realpathSync(path.dirname(packageJsonPath));
  const entry = fs.realpathSync(path.join(root, rel));
  if (entry !== root && !entry.startsWith(`${root}${path.sep}`)) throw Object.assign(new Error('Package executable escapes package root'), { code: 'BIN_ESCAPE' });
  return entry;
}

function resolveDshEntry(appDir) {
  return resolvePackageBin(path.join(appDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'dsh');
}

function resolvePnpmEntry(appDir, resourcesPath, isPackaged) {
  const candidates = isPackaged
    ? [path.join(resourcesPath, 'pnpm', 'bin', 'pnpm.cjs'), path.join(appDir, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')]
    : [path.join(appDir, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

module.exports = { resolveDshEntry, resolvePackageBin, resolvePnpmEntry };
