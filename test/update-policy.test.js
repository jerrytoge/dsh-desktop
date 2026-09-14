const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('Renovate manages only real dependencies and waits 48 hours', () => {
  const config = JSON.parse(read('renovate.json'));
  assert.equal(config.automerge, false);
  const rule = config.packageRules.find((r) => r.groupSlug === 'deepseek-harness');
  assert.equal(rule.minimumReleaseAge, '2 days');
  assert.equal(rule.minimumReleaseAgeBehaviour, 'timestamp-required');
  assert.equal(rule.rangeStrategy, 'bump');
  assert.equal(rule.ignoreUnstable, false);
  assert.equal(rule.allowedVersions, '!/-alpha(?:\\.|$)/');
  // Regression, observed on PR #1: the DeepSeek packages publish each release
  // under the "next" tag while "latest" lags behind. Renovate's respectLatest
  // only skips versions above "latest" when the current version is not itself
  // past "latest" - so the one package whose "latest" tag had not moved
  // (@deepseek-ai/dsh, still tagged 0.1.5-rc.1) was held back while its ~80
  // siblings advanced, yielding a mixed-version PR that failed CI. The docs
  // pair ignoreUnstable:false with respectLatest:false for exactly this case.
  assert.equal(rule.respectLatest, false, 'ignoreUnstable:false requires respectLatest:false');
  // Renovate owns dependency ranges only; the root version is informational and
  // derived by CI at build time, so it needs no custom manager.
  assert.equal(config.customManagers, undefined);
});

test('dead allowScripts config is gone and native builds are allowed by name', () => {
  // pnpm 11 never reads a root package.json "allowScripts" key, so the
  // exact-version entries were dead weight that had to be bumped by hand.
  assert.equal(JSON.parse(read('package.json')).allowScripts, undefined);
  const policy = yaml.load(read('pnpm-workspace.yaml'));
  assert.equal(policy.allowBuilds['@deepseek-ai/dsh-subprocess-local'], true);
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
