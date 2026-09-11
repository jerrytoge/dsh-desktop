const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('Renovate groups version metadata with dependencies and waits 48 hours', () => {
  const config = JSON.parse(read('renovate.json'));
  assert.equal(config.automerge, false);
  const rule = config.packageRules.find((r) => r.groupSlug === 'deepseek-harness');
  assert.equal(rule.minimumReleaseAge, '2 days');
  assert.equal(rule.minimumReleaseAgeBehaviour, 'timestamp-required');
  assert.equal(rule.rangeStrategy, 'bump');
  assert.equal(rule.ignoreUnstable, false);
  assert.equal(rule.allowedVersions, '!/-alpha(?:\\.|$)/');
  const manager = config.customManagers[0];
  assert.equal(manager.depNameTemplate, '@deepseek-ai/dsh');
  const manifest = read('package.json');
  const versions = manager.matchStrings.map((pattern) => new RegExp(pattern).exec(manifest)?.groups.currentValue);
  assert.deepEqual(versions, [JSON.parse(manifest).version, JSON.parse(manifest).version]);
});

test('CI checks consistency before release suffix and smoke before artifact publication', () => {
  const ci = read('.github/workflows/build.yml');
  const at = (text) => { const index = ci.indexOf(text); assert.ok(index >= 0, text); return index; };
  assert.ok(at('pnpm install --frozen-lockfile') < at('pnpm run check:harness'));
  assert.ok(at('pnpm run check:harness') < at('Derive version from harness'));
  assert.ok(at('pnpm test') < at('Derive version from harness'));
  assert.ok(at('pnpm run smoke:packaged') < at('Collect release artifacts'));
  assert.ok(ci.includes('needs: build'));
});
