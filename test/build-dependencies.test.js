'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

test('electron-builder resolves an electron-get cache-mode API', () => {
  const appBuilderDir = fs.readdirSync(path.join(__dirname, '..', 'node_modules', '.pnpm'))
    .find((name) => name.startsWith('app-builder-lib@26.15.3_'));
  assert.ok(appBuilderDir, 'app-builder-lib virtual-store package is installed');
  const builderModule = path.join(
    __dirname,
    '..',
    'node_modules',
    '.pnpm',
    appBuilderDir,
    'node_modules',
    'app-builder-lib',
    'out',
    'util',
    'electronGet.js',
  );
  const builderRequire = createRequire(builderModule);
  const electronGet = builderRequire('@electron/get');
  assert.equal(electronGet.ElectronDownloadCacheMode.ReadWrite, 0);
  const electronGetEntry = builderRequire.resolve('@electron/get');
  const electronGetPackage = JSON.parse(fs.readFileSync(path.join(electronGetEntry, '..', '..', 'package.json'), 'utf8'));
  assert.equal(electronGetPackage.version, '4.0.3');
});
