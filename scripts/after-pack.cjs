'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ARCH_NAMES = new Map([
  [0, 'ia32'],
  [1, 'x64'],
  [2, 'armv7l'],
  [3, 'arm64'],
  [4, 'universal'],
]);

const KEEP_BY_FAMILY = {
  '@img': new Set(['colour', 'sharp-darwin-arm64', 'sharp-libvips-darwin-arm64']),
  '@vscode': new Set(['ripgrep', 'ripgrep-darwin-arm64']),
  '@koromix': new Set(['koffi-darwin-arm64']),
};

function listDirectories(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
}

function assertRequiredPackages(nodeModules) {
  for (const [scope, keep] of Object.entries(KEEP_BY_FAMILY)) {
    const scopeDirectory = path.join(nodeModules, scope);
    for (const packageName of keep) {
      const packageDirectory = path.join(scopeDirectory, packageName);
      if (!fs.existsSync(packageDirectory)) {
        throw new Error(`required packaged dependency is missing: ${scope}/${packageName}`);
      }
    }
  }

  const nativeLoader = path.join(nodeModules, 'node-addon-require-builtin-darwin-arm64');
  if (!fs.existsSync(nativeLoader)) {
    throw new Error('required packaged dependency is missing: node-addon-require-builtin-darwin-arm64');
  }
}

function prunePackagedDependencies(nodeModules) {
  const deepseekDirectory = path.join(nodeModules, '@deepseek-ai');
  const deepseekBefore = listDirectories(deepseekDirectory);
  if (deepseekBefore.length === 0) {
    throw new Error('packaged @deepseek-ai dependencies are missing; refusing to prune');
  }

  assertRequiredPackages(nodeModules);

  const removed = [];
  for (const [scope, keep] of Object.entries(KEEP_BY_FAMILY)) {
    const scopeDirectory = path.join(nodeModules, scope);
    for (const packageName of listDirectories(scopeDirectory)) {
      if (keep.has(packageName)) continue;
      fs.rmSync(path.join(scopeDirectory, packageName), { recursive: true, force: true });
      removed.push(`${scope}/${packageName}`);
    }
  }

  for (const packageName of listDirectories(nodeModules)) {
    if (!packageName.startsWith('node-addon-require-builtin-')) continue;
    if (packageName === 'node-addon-require-builtin-darwin-arm64') continue;
    fs.rmSync(path.join(nodeModules, packageName), { recursive: true, force: true });
    removed.push(packageName);
  }

  const deepseekAfter = listDirectories(deepseekDirectory);
  if (deepseekAfter.length !== deepseekBefore.length ||
      deepseekAfter.some((packageName, index) => packageName !== deepseekBefore[index])) {
    throw new Error('@deepseek-ai package set changed during platform pruning');
  }

  assertRequiredPackages(nodeModules);
  return { removed: removed.sort(), deepseekPackages: deepseekAfter.length };
}

async function afterPack(context) {
  const platform = context.electronPlatformName;
  const arch = typeof context.arch === 'string' ? context.arch : ARCH_NAMES.get(context.arch);
  if (platform !== 'darwin' || arch !== 'arm64') {
    throw new Error(`platform pruning is intentionally limited to darwin-arm64, received ${platform}-${arch || context.arch}`);
  }

  const nodeModules = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Resources',
    'app',
    'node_modules',
  );
  if (!fs.existsSync(nodeModules)) {
    throw new Error(`packaged node_modules not found: ${nodeModules}`);
  }

  const result = prunePackagedDependencies(nodeModules);
  console.log(`[afterPack] removed ${result.removed.length} non-darwin-arm64 packages`);
  console.log(`[afterPack] preserved ${result.deepseekPackages} @deepseek-ai packages`);
}

module.exports = afterPack;
module.exports.prunePackagedDependencies = prunePackagedDependencies;
