'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('build scripts always prepare the configured Electron dist', () => {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const builder = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
  assert.equal(pkg.scripts['prepare:build'], 'node scripts/fetch-electron.mjs');
  assert.match(pkg.scripts.build, /^node scripts\/fetch-electron\.mjs && /);
  assert.match(pkg.scripts['build:dir'], /^node scripts\/fetch-electron\.mjs && /);
  assert.match(builder, /electronDist: node_modules\/electron\/dist/);
  assert.equal(fs.existsSync(path.join(root, 'scripts', 'fetch-electron.mjs')), true);
});
