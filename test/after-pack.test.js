'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prunePackagedDependencies } = require('../scripts/after-pack.cjs');

function makePackage(nodeModules, packageName) {
  fs.mkdirSync(path.join(nodeModules, ...packageName.split('/')), { recursive: true });
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-after-pack-'));
  const nodeModules = path.join(root, 'node_modules');
  const packages = [
    '@deepseek-ai/dsh',
    '@deepseek-ai/dsh-authorization',
    '@img/colour',
    '@img/sharp-darwin-arm64',
    '@img/sharp-libvips-darwin-arm64',
    '@img/sharp-linux-x64',
    '@img/sharp-win32-x64',
    '@vscode/ripgrep',
    '@vscode/ripgrep-darwin-arm64',
    '@vscode/ripgrep-linux-x64',
    '@koromix/koffi-darwin-arm64',
    '@koromix/koffi-win32-x64',
    'node-addon-require-builtin-darwin-arm64',
    'node-addon-require-builtin-linux-x64-gnu',
    'unrelated-package',
  ];
  for (const packageName of packages) makePackage(nodeModules, packageName);
  return { root, nodeModules };
}

test('afterPack pruning removes only non-darwin-arm64 native variants', (t) => {
  const { root, nodeModules } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = prunePackagedDependencies(nodeModules);

  assert.equal(result.deepseekPackages, 2);
  assert.deepEqual(fs.readdirSync(path.join(nodeModules, '@deepseek-ai')).sort(), ['dsh', 'dsh-authorization']);
  assert.equal(fs.existsSync(path.join(nodeModules, '@img', 'sharp-linux-x64')), false);
  assert.equal(fs.existsSync(path.join(nodeModules, '@vscode', 'ripgrep-linux-x64')), false);
  assert.equal(fs.existsSync(path.join(nodeModules, '@koromix', 'koffi-win32-x64')), false);
  assert.equal(fs.existsSync(path.join(nodeModules, 'node-addon-require-builtin-linux-x64-gnu')), false);
  assert.equal(fs.existsSync(path.join(nodeModules, '@img', 'sharp-darwin-arm64')), true);
  assert.equal(fs.existsSync(path.join(nodeModules, '@vscode', 'ripgrep-darwin-arm64')), true);
  assert.equal(fs.existsSync(path.join(nodeModules, '@koromix', 'koffi-darwin-arm64')), true);
  assert.equal(fs.existsSync(path.join(nodeModules, 'node-addon-require-builtin-darwin-arm64')), true);
  assert.equal(fs.existsSync(path.join(nodeModules, 'unrelated-package')), true);
});

test('afterPack pruning fails closed when a required native package is absent', (t) => {
  const { root, nodeModules } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.rmSync(path.join(nodeModules, '@img', 'sharp-darwin-arm64'), { recursive: true });

  assert.throws(
    () => prunePackagedDependencies(nodeModules),
    /required packaged dependency is missing: @img\/sharp-darwin-arm64/,
  );
  assert.equal(fs.existsSync(path.join(nodeModules, '@img', 'sharp-linux-x64')), true);
});
