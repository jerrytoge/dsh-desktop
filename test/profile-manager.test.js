'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { inspectProfile, parseInstallSpec, reconcileBundles, PersonalPluginManager, runProcess, declaresCordisPlugin, setCordisPlugin, readCordisPatch, stripBomFromFile, healProfileManifestsSync } = require('../lib/profile-manager');

async function fixture() { return fs.mkdtemp(path.join(os.tmpdir(), 'dsh-desktop-profile-')); }

test('runProcess preserves lines split across stdout chunks', async () => {
  const result = await runProcess(process.execPath, ['-e', "process.stdout.write('6cea4bdd6f178ddc57f5');setTimeout(()=>process.stdout.write('d0a12d655a19a010d66a\\tHEAD\\n'),5)"], { env: process.env });
  assert.equal(result.code, 0);
  assert.deepEqual(result.lines.map((line) => line.text), ['6cea4bdd6f178ddc57f5d0a12d655a19a010d66a\tHEAD']);
});

test('parseInstallSpec accepts registry specs and rejects local paths/options', () => {
  assert.deepEqual(parseInstallSpec('@scope/plugin@1.2.3'), { name: '@scope/plugin', spec: '@scope/plugin@1.2.3', source: 'registry' });
  assert.deepEqual(parseInstallSpec('plugin@latest').name, 'plugin');
  for (const bad of ['', '../plugin', 'file:../plugin', '--global', 'plugin other']) assert.throws(() => parseInstallSpec(bad));
});

test('inventory only returns personal direct dependencies and reads BOM manifests', async () => {
  const dir = await fixture();
  await fs.mkdir(path.join(dir, 'node_modules', 'personal-plugin'), { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { 'personal-plugin': '^1.0.0', 'plain-lib': '^1.0.0' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'personal-plugin'] } } }));
  await fs.writeFile(path.join(dir, 'node_modules', 'personal-plugin', 'package.json'), `\ufeff${JSON.stringify({ name: 'personal-plugin', version: '1.2.0', description: 'A personal  test\n   plugin', dsh: { bundle: { patch: './cordis.patch.yml' } } })}`);
  await fs.mkdir(path.join(dir, 'node_modules', 'plain-lib'), { recursive: true });
  await fs.writeFile(path.join(dir, 'node_modules', 'plain-lib', 'package.json'), JSON.stringify({ name: 'plain-lib', version: '1.0.0' }));
  const result = await inspectProfile(dir);
  assert.equal(result.plugins.length, 2);
  assert.equal(result.plugins[0].packageName, 'personal-plugin');
  assert.equal(result.plugins[0].installedVersion, '1.2.0');
  assert.equal(result.plugins[0].activeBundle, true);
  // description is read from the installed manifest and whitespace-collapsed
  assert.equal(result.plugins[0].description, 'A personal test plugin');
  // packages without a description surface null
  assert.equal(result.plugins[1].description, null);
});

test('reconciliation preserves official bundles and updates personal bundles', async () => {
  const dir = await fixture();
  await fs.mkdir(path.join(dir, 'node_modules', 'plain'), { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { plain: '1.0.0' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'removed-plugin'] } } }));
  await fs.writeFile(path.join(dir, 'node_modules', 'plain', 'package.json'), JSON.stringify({ name: 'plain', version: '1.0.0' }));
  await reconcileBundles(dir, { removed: ['removed-plugin'] });
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']);
});

test('enable switch only changes a personal declared bundle and preserves official bundles', async () => {
  const dir = await fixture();
  await fs.mkdir(path.join(dir, 'node_modules', 'personal-plugin'), { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { 'personal-plugin': '1.0.0' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'personal-plugin'] } } }));
  await fs.writeFile(path.join(dir, 'node_modules', 'personal-plugin', 'package.json'), JSON.stringify({ name: 'personal-plugin', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }));
  const manager = new PersonalPluginManager({ profileDir: dir, nodePath: __filename, pnpmEntry: __filename, env: { DSH_HOME: dir } });
  let result = await manager.setEnabled('personal-plugin', false);
  assert.equal(result.restartRequired, true);
  assert.equal(result.snapshot.plugins[0].activeBundle, false);
  let manifest = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']);
  result = await manager.setEnabled('personal-plugin', true);
  assert.equal(result.snapshot.plugins[0].activeBundle, true);
  manifest = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'personal-plugin']);
  await assert.rejects(manager.setEnabled('@deepseek-ai/dsh-base', false), { code: 'OFFICIAL_BUNDLE' });
});

test('plain cordis plugins are detected and toggled via cordis.patch.yml', async () => {
  assert.equal(declaresCordisPlugin({ name: 'x', peerDependencies: { '@deepseek-ai/cordis': '^4.0.0' } }), true);
  assert.equal(declaresCordisPlugin({ name: 'x', dependencies: { '@deepseek-ai/cordis': '^4.0.0' } }), true);
  assert.equal(declaresCordisPlugin({ name: 'x', dependencies: { lodash: '^4.0.0' } }), false);
  assert.equal(declaresCordisPlugin({ name: 'x', dsh: { bundle: { patch: './p.yml' } }, peerDependencies: { '@deepseek-ai/cordis': '^4.0.0' } }), false);

  const dir = await fixture();
  await fs.mkdir(path.join(dir, 'node_modules', 'dsh-memory-plugin'), { recursive: true });
  await fs.mkdir(path.join(dir, 'node_modules', 'plain-library'), { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { 'dsh-memory-plugin': '^0.7.2', 'plain-library': '^1.0.0' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }));
  await fs.writeFile(path.join(dir, 'node_modules', 'dsh-memory-plugin', 'package.json'), JSON.stringify({ name: 'dsh-memory-plugin', version: '0.7.2', peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' } }));
  await fs.writeFile(path.join(dir, 'node_modules', 'plain-library', 'package.json'), JSON.stringify({ name: 'plain-library', version: '1.0.0' }));
  const manager = new PersonalPluginManager({ profileDir: dir, nodePath: __filename, pnpmEntry: __filename, env: { DSH_HOME: dir } });

  let snapshot = await manager.list();
  assert.equal(snapshot.plugins[0].declaresBundle, false);
  assert.equal(snapshot.plugins[0].isCordisPlugin, true);
  assert.equal(snapshot.plugins[0].toggleable, true);
  assert.equal(snapshot.plugins[0].enabled, false);

  let result = await manager.setEnabled('dsh-memory-plugin', true);
  assert.equal(result.restartRequired, true);
  assert.equal(result.snapshot.plugins[0].enabled, true);
  const patch = await readCordisPatch(dir);
  assert.deepEqual(patch, [{ insert: [{ id: 'dsh-memory-plugin', name: 'dsh-memory-plugin' }] }]);

  result = await manager.setEnabled('dsh-memory-plugin', false);
  assert.equal(result.snapshot.plugins[0].enabled, false);
  assert.deepEqual(await readCordisPatch(dir), []);

  assert.deepEqual(setCordisPlugin([{ insert: [{ id: 'other', name: 'other-plugin' }] }], 'dsh-memory-plugin', true), [{ insert: [{ id: 'other', name: 'other-plugin' }] }, { insert: [{ id: 'dsh-memory-plugin', name: 'dsh-memory-plugin' }] }]);
  await assert.rejects(manager.setEnabled('plain-library', true), { code: 'NOT_TOGGLEABLE' });
});

test('stripBomFromFile removes a UTF-8 BOM without touching clean files', async () => {
  const dir = await fixture();
  const bom = path.join(dir, 'bom.json');
  const clean = path.join(dir, 'clean.json');
  await fs.writeFile(bom, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"a":1}')]));
  await fs.writeFile(clean, '{"a":1}');
  assert.equal(await stripBomFromFile(bom), true);
  assert.equal(await fs.readFile(bom, 'utf8'), '{"a":1}');
  assert.equal(await stripBomFromFile(bom), false);
  assert.equal(await stripBomFromFile(clean), false);
  assert.equal(await stripBomFromFile(path.join(dir, 'missing.json')), false);
});

test('enabling a cordis plugin heals its BOM before writing the insert entry', async () => {
  const dir = await fixture();
  await fs.mkdir(path.join(dir, 'node_modules', 'dsh-memory-plugin'), { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { 'dsh-memory-plugin': '^0.7.2' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }));
  const manifest = path.join(dir, 'node_modules', 'dsh-memory-plugin', 'package.json');
  const body = JSON.stringify({ name: 'dsh-memory-plugin', version: '0.7.2', peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' } });
  await fs.writeFile(manifest, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body)]));
  const manager = new PersonalPluginManager({ profileDir: dir, nodePath: __filename, pnpmEntry: __filename, env: { DSH_HOME: dir } });
  const result = await manager.setEnabled('dsh-memory-plugin', true);
  assert.equal(result.restartRequired, true);
  assert.equal(result.snapshot.plugins[0].enabled, true);
  assert.equal(await fs.readFile(manifest, 'utf8'), body);
  assert.deepEqual(await readCordisPatch(dir), [{ insert: [{ id: 'dsh-memory-plugin', name: 'dsh-memory-plugin' }] }]);
});

test('healProfileManifestsSync strips BOM from all direct dependency manifests', () => {
  const { mkdirSync, writeFileSync, readFileSync, mkdtempSync } = require('node:fs');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-heal-'));
  mkdirSync(path.join(dir, 'node_modules', 'pkg-bom'), { recursive: true });
  mkdirSync(path.join(dir, 'node_modules', 'pkg-clean'), { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { 'pkg-bom': '^1.0.0', 'pkg-clean': '^1.0.0' } }));
  writeFileSync(path.join(dir, 'node_modules', 'pkg-bom', 'package.json'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"name":"pkg-bom"}')]));
  writeFileSync(path.join(dir, 'node_modules', 'pkg-clean', 'package.json'), '{"name":"pkg-clean"}');
  assert.deepEqual(healProfileManifestsSync(dir), ['pkg-bom']);
  assert.equal(readFileSync(path.join(dir, 'node_modules', 'pkg-bom', 'package.json'), 'utf8'), '{"name":"pkg-bom"}');
  assert.equal(readFileSync(path.join(dir, 'node_modules', 'pkg-clean', 'package.json'), 'utf8'), '{"name":"pkg-clean"}');
});

test('mutations are serialized and use literal argv arrays', async () => {
  const dir = await fixture();
  const fakeNode = path.join(dir, 'node'); const fakePnpm = path.join(dir, 'pnpm.cjs');
  await fs.writeFile(fakeNode, ''); await fs.writeFile(fakePnpm, '');
  const calls = [];
  const hostilePnpm = '/Users/test/Library/pnpm/store/v11/links/@/pnpm/10.15.0/bin';
  const manager = new PersonalPluginManager({
    profileDir: dir,
    nodePath: fakeNode,
    pnpmEntry: fakePnpm,
    runtimeBinDir: path.join(dir, 'runtime-bin'),
    env: { PATH: hostilePnpm },
    run: async (file, args, options) => { calls.push({ file, args, options }); return { code: 0, lines: [] }; },
  });
  await manager.install('example-plugin@1.0.0');
  assert.deepEqual(calls[0].args, [fakePnpm, 'add', 'example-plugin@1.0.0', '--save-prod']);
  assert.equal(calls[0].options.env.PATH.split(path.delimiter)[0], path.join(dir, 'runtime-bin'));
  assert.equal(calls[0].options.env.NODE, fakeNode);
  assert.equal(calls[0].options.env.npm_node_execpath, fakeNode);
  const pnpmLauncher = await fs.readFile(path.join(dir, 'runtime-bin', 'pnpm'), 'utf8');
  assert.match(pnpmLauncher, new RegExp(fakeNode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(pnpmLauncher, new RegExp(fakePnpm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Registry updates resolve latest at mutation time instead of installing a cached version', async () => {
  const dir = await fixture();
  const fakeNode = path.join(dir, 'node'); const fakePnpm = path.join(dir, 'pnpm.cjs');
  await fs.writeFile(fakeNode, ''); await fs.writeFile(fakePnpm, '');
  await fs.mkdir(path.join(dir, 'node_modules', 'example-plugin'), { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { 'example-plugin': '1.0.0' } }));
  await fs.writeFile(path.join(dir, 'node_modules', 'example-plugin', 'package.json'), JSON.stringify({ name: 'example-plugin', version: '1.0.0' }));
  const calls = [];
  const manager = new PersonalPluginManager({
    profileDir: dir,
    nodePath: fakeNode,
    pnpmEntry: fakePnpm,
    runtimeBinDir: path.join(dir, 'runtime-bin'),
    run: async (file, args, options) => { calls.push({ file, args, options }); return { code: 0, lines: [] }; },
  });
  await manager.update('example-plugin', '1.1.0');
  assert.deepEqual(calls[0].args, [fakePnpm, 'add', 'example-plugin@latest', '--save-prod']);
});

test('Registry update checks do not rewrite runtime launchers', async () => {
  const dir = await fixture();
  const fakeNode = path.join(dir, 'node'); const fakePnpm = path.join(dir, 'pnpm.cjs');
  const runtimeBinDir = path.join(dir, 'read-only-runtime-bin');
  await fs.writeFile(fakeNode, ''); await fs.writeFile(fakePnpm, '');
  await fs.mkdir(path.join(dir, 'node_modules', 'example-plugin'), { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { 'example-plugin': '^1.0.0' } }));
  await fs.writeFile(path.join(dir, 'node_modules', 'example-plugin', 'package.json'), JSON.stringify({ name: 'example-plugin', version: '1.0.0' }));
  const calls = [];
  const manager = new PersonalPluginManager({
    profileDir: dir,
    nodePath: fakeNode,
    pnpmEntry: fakePnpm,
    runtimeBinDir,
    env: { PATH: '/hostile/global/pnpm' },
    run: async (file, args, options) => {
      calls.push({ file, args, options });
      return { code: 0, lines: [{ kind: 'stdout', text: '"1.1.0"' }] };
    },
  });
  const result = await manager.checkUpdates();
  assert.equal(result.plugins[0].latestVersion, '1.1.0');
  assert.equal(result.plugins[0].updateAvailable, true);
  assert.equal(calls[0].file, fakeNode);
  assert.deepEqual(calls[0].args, [fakePnpm, 'view', 'example-plugin', 'version', '--json']);
  assert.equal(calls[0].options.cwd, path.dirname(fakeNode));
  await assert.rejects(fs.access(runtimeBinDir));
});
