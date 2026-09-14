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
  // Regression: a regex customManager that reused depName "@deepseek-ai/dsh" to
  // track the root "version" field collided with the real dependency of the
  // same name in the same package.json. Renovate de-duplicates by depName, so
  // NONE of them were updated and the resulting PR was inconsistent. Renovate
  // must therefore own dependency ranges only.
  assert.equal(config.customManagers, undefined, 'no manager may reuse a real depName');
  const rule = config.packageRules.find((r) => r.groupSlug === 'deepseek-harness');
  assert.equal(rule.minimumReleaseAge, '2 days');
  assert.equal(rule.minimumReleaseAgeBehaviour, 'timestamp-required');
  assert.equal(rule.rangeStrategy, 'bump');
  assert.equal(rule.ignoreUnstable, false);
  assert.equal(rule.allowedVersions, '!/-alpha(?:\\.|$)/');
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
