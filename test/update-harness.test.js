const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');
const api = import('../scripts/update-harness.mjs');
const OLD = '0.1.2-rc.1', TARGET = '0.1.5-rc.1';
const NOW = Date.parse('2026-09-12T00:00:00Z');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'update-harness-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'packages/ui'), { recursive: true });
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\nminimumReleaseAgeStrict: true\n');
  const data = { version: OLD, dependencies: { '@deepseek-ai/dsh': `^${OLD}`, '@deepseek-ai/cordis': '^4.0.2' } };
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(data));
  fs.writeFileSync(path.join(root, 'packages/ui/package.json'), JSON.stringify({ version: '0.1.0', peerDependencies: { '@deepseek-ai/dsh-ui': `^${OLD}` } }));
  writeLock(root, OLD);
  return root;
}
function writeLock(root, version, extra = {}) {
  const entry = { specifier: `^${version}`, version: `${version}(peer@1.0.0)` };
  fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), yaml.dump({ lockfileVersion: '9.0', importers: { '.': { dependencies: { '@deepseek-ai/dsh': entry } }, 'packages/ui': { dependencies: { '@deepseek-ai/dsh-ui': entry } } }, packages: { [`@deepseek-ai/dsh@${version}`]: {}, [`@deepseek-ai/dsh-ui@${version}`]: {}, ...extra } }));
}
const metadataFetch = ({ age = 72, absent = false, dependencies = {} } = {}) => async () => ({ ok: true, json: async () => ({ versions: absent ? {} : { [TARGET]: { dependencies } }, time: { [TARGET]: new Date(NOW - age * 3600000).toISOString() } }) });

test('updater CLI requires canonical explicit target and rejects invalid options', async () => {
  const { parseArgs } = await api;
  for (const args of [[], ['latest'], ['^0.1.5'], ['v0.1.5'], [TARGET, OLD], ['--wat'], [TARGET, '--registry', 'http://bad'], [TARGET, '--registry'], ['--check', '--bypass-release-age']]) assert.throws(() => parseArgs(args));
  assert.equal(parseArgs(['--check']).check, true);
  assert.equal(parseArgs([TARGET, '--bypass-release-age']).bypassReleaseAge, true);
});

test('synchronize changes only Harness ranges and the root version', async () => {
  const { synchronize } = await api;
  const source = { version: OLD, dependencies: { '@deepseek-ai/dsh': `^${OLD}`, '@deepseek-ai/dshmarket': '1', '@deepseek-ai/cordis': '^4' }, peerDependencies: { '@deepseek-ai/dsh-ui': '*' } };
  const result = synchronize(source, TARGET, true);
  assert.equal(source.version, OLD);
  assert.equal(result.version, TARGET);
  assert.equal(result.dependencies['@deepseek-ai/dsh'], `^${TARGET}`);
  assert.equal(result.dependencies['@deepseek-ai/dshmarket'], '1');
  assert.equal(result.dependencies['@deepseek-ai/cordis'], '^4');
  assert.equal(result.peerDependencies['@deepseek-ai/dsh-ui'], `^${TARGET}`);
  assert.equal(synchronize(source, TARGET, false).version, OLD);
});

test('registry checks age, missing packages, missing timestamps, HTTP and bypass semantics', async () => {
  const { validatePublished } = await api;
  const validate = opts => validatePublished(['@deepseek-ai/dsh'], TARGET, { now: NOW, ...opts });
  await assert.rejects(validate({ fetchImpl: metadataFetch({ age: 23 }) }), /less than 48h/);
  await validate({ fetchImpl: metadataFetch({ age: 48 }) });
  await validate({ fetchImpl: metadataFetch({ age: 1 }), bypassReleaseAge: true });
  await assert.rejects(validate({ fetchImpl: metadataFetch({ absent: true }), bypassReleaseAge: true }), /not published/);
  await assert.rejects(validate({ fetchImpl: metadataFetch({ age: -1 }), bypassReleaseAge: true }), /Future/);
  await assert.rejects(validate({ fetchImpl: async () => ({ ok: false, status: 503 }) }), /HTTP 503/);
  await assert.rejects(validate({ fetchImpl: async () => ({ ok: true, json: async () => ({ versions: { [TARGET]: {} } }) }) }), /Missing publication/);
});

test('registry walks new Harness transitives once and rejects incompatible dependency ranges', async () => {
  const { validatePublished } = await api;
  const calls = [];
  const fetchImpl = async url => {
    const name = decodeURIComponent(url.split('/').pop()); calls.push(name);
    return metadataFetch({ dependencies: { '@deepseek-ai/dsh-new': `^${TARGET}`, unrelated: '*' } })();
  };
  assert.deepEqual(await validatePublished(['@deepseek-ai/dsh'], TARGET, { fetchImpl, now: NOW }), ['@deepseek-ai/dsh', '@deepseek-ai/dsh-new']);
  assert.equal(calls.length, 2);
  await assert.rejects(validatePublished(['@deepseek-ai/dsh'], TARGET, { fetchImpl: metadataFetch({ dependencies: { '@deepseek-ai/dsh-new': '^9.0.0' } }), now: NOW }), /incompatible/);
});

test('failed preflight leaves manifests lockfile and policies byte-identical', async t => {
  const { run } = await api; const root = fixture(t);
  const files = ['package.json', 'packages/ui/package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'];
  const before = files.map(file => fs.readFileSync(path.join(root, file), 'utf8'));
  await assert.rejects(run({ target: TARGET }, { root, fetchImpl: metadataFetch({ age: 1 }), now: NOW, install: () => assert.fail('must not install') }), /48h/);
  assert.deepEqual(files.map(file => fs.readFileSync(path.join(root, file), 'utf8')), before);
});

test('update synchronizes fixtures, invokes install, and summarizes new transitives', async t => {
  const { run } = await api; const root = fixture(t); const logs = [];
  await run({ target: TARGET }, { root, now: NOW, fetchImpl: metadataFetch(), log: s => logs.push(s), install: cwd => {
    assert.equal(cwd, root);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, TARGET);
    writeLock(root, TARGET, { [`@deepseek-ai/dsh-new@${TARGET}`]: {} });
  } });
  assert.ok(logs.some(s => s.includes('Added Harness packages: @deepseek-ai/dsh-new')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'packages/ui/package.json'))).version, '0.1.0');
  assert.equal(fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8'), 'packages:\n  - packages/*\nminimumReleaseAgeStrict: true\n');
});

test('offline check never fetches installs or writes and detects drift', async t => {
  const { run, readProject, checkConsistency } = await api; const root = fixture(t);
  const options = { root, fetchImpl: () => assert.fail('network'), install: () => assert.fail('install'), log: () => {} };
  const before = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  await run({ check: true }, options);
  assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), before);
  await assert.rejects(run({ check: true, target: TARGET }, options), /consistency check failed/);
  const project = readProject(root), lock = yaml.load(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8'));
  project.manifests[1].data.peerDependencies['@deepseek-ai/dsh-ui'] = '*';
  lock.importers['.'].dependencies['@deepseek-ai/dsh'].specifier = '*';
  lock.packages[`@deepseek-ai/dsh@${TARGET}`] = {};
  const errors = checkConsistency(project, OLD, lock).join('\n');
  assert.match(errors, /expected \^/);
  assert.match(errors, /importer does not match/);
  assert.match(errors, /expected only/);
});

// Regression: Renovate bumps the dependency ranges as a group and does not (and
// must not) own the informational root version. That state has to pass CI.
test('dependency ranges are the source of truth; root version drift only warns', async t => {
  const { run, readProject, deriveTarget, versionDrift } = await api;
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: OLD, dependencies: { '@deepseek-ai/dsh': `^${TARGET}` } }));
  fs.writeFileSync(path.join(root, 'packages/ui/package.json'), JSON.stringify({ version: '0.1.0', peerDependencies: { '@deepseek-ai/dsh-ui': `^${TARGET}` } }));
  writeLock(root, TARGET);
  const project = readProject(root);
  assert.equal(deriveTarget(project), TARGET, 'target must come from the dependency ranges, not the stale version');
  assert.match(versionDrift(project, TARGET), /differs from Harness/);
  const logs = [];
  await run({ check: true }, { root, fetchImpl: () => assert.fail('network'), install: () => assert.fail('install'), log: s => logs.push(s) });
  assert.ok(logs.some(s => s.startsWith('Warning:') && s.includes('differs from Harness')), 'drift must be reported');
  assert.ok(logs.some(s => s.includes('consistent')), 'drift must not fail the check');
});

test('pnpm exit status propagates without shell pipeline masking', async t => {
  const { installWithPnpm } = await api; const root = fixture(t);
  fs.mkdirSync(path.join(root, 'node_modules/pnpm/bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules/pnpm/bin/pnpm.cjs'), 'process.exit(37);');
  assert.throws(() => installWithPnpm(root), error => error.exitCode === 37);
  fs.writeFileSync(path.join(root, 'node_modules/pnpm/bin/pnpm.cjs'), 'process.exit(0);');
  assert.doesNotThrow(() => installWithPnpm(root));
});

test('unsupported workspace layouts fail closed', async t => {
  const { readProject } = await api;
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - plugins/**\n');
  assert.throws(() => readProject(root), /workspace layout/);
});

test('failed install propagates and stale post-install lock fails verification', async t => {
  const { run } = await api; const root = fixture(t);
  const options = { root, now: NOW, fetchImpl: metadataFetch(), log: () => {} };
  await assert.rejects(run({ target: TARGET }, { ...options, install: () => { const error = new Error('install failed'); error.exitCode = 37; throw error; } }), error => error.exitCode === 37);
  await assert.rejects(run({ target: TARGET }, { ...options, install: () => {} }), /Post-install consistency check failed/);
});

test('CLI invalid invocation is nonzero', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/update-harness.mjs'), 'latest'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /canonical semver/);
});
