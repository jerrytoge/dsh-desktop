const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const load = () => import('../scripts/verify-bundle.mjs');

function writeManifest(dir, manifest, files = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

// Layout mirrors pnpm's virtual store: a symlinked top-level package whose
// dependencies live as siblings under .pnpm/<pkg>/node_modules/.
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-bundle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeManifest(root, { name: 'app', dependencies: {
    nested: '^1.0.0', linked: '^1.0.0', absentOptional: '^1.0.0',
    'node-addon-require-builtin-linux-x64': '^1.0.0', '@img/sharp-win32-x64': '^1.0.0' },
  devDependencies: { devOnlyTool: '^1.0.0' } });
  // nested: child under the package's own node_modules
  writeManifest(path.join(root, 'node_modules/nested'), { name: 'nested', version: '1.0.0',
    dependencies: { deep: '^1.0.0' } });
  writeManifest(path.join(root, 'node_modules/nested/node_modules/deep'), { name: 'deep', version: '1.0.0' });
  // linked: symlink into the virtual store; deps are siblings of the package dir
  const store = path.join(root, 'node_modules/.pnpm/linked@1.0.0/node_modules');
  writeManifest(path.join(store, 'linked'), { name: 'linked', version: '1.0.0', dependencies: { sidekick: '^1.0.0' } });
  writeManifest(path.join(store, 'sidekick'), { name: 'sidekick', version: '1.0.0' });
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.symlinkSync(path.relative(path.join(root, 'node_modules'), path.join(store, 'linked')),
    path.join(root, 'node_modules/linked'));
  // platform names present in source but intentionally absent from bundles
  writeManifest(path.join(root, 'node_modules/node-addon-require-builtin-linux-x64'), { name: 'node-addon-require-builtin-linux-x64', version: '1.0.0' });
  writeManifest(path.join(root, 'node_modules/@img/sharp-win32-x64'), { name: 'sharp-win32-x64', version: '1.0.0' });
  // devOnlyTool exists on disk (pnpm installs dev deps) but is not a prod dep
  writeManifest(path.join(root, 'node_modules/devOnlyTool'), { name: 'devOnlyTool', version: '1.0.0' });
  // absentOptional has no directory — platform-skipped optional behaviour
  return root;
}

test('closure walks nested, pnpm-sibling and optional packages but not devDependencies', async t => {
  const { sourceClosure } = await load();
  const closure = sourceClosure(fixture(t));
  for (const name of ['nested', 'deep', 'linked', 'sidekick', 'node-addon-require-builtin-linux-x64', '@img/sharp-win32-x64'])
    assert.ok(closure.has(name), `${name} must be in the source closure`);
  assert.ok(!closure.has('devOnlyTool'), 'devDependencies must not be walked');
  assert.ok(!closure.has('absentOptional'), 'absent optionals must not be walked');
});

test('missingFromBundle reports real gaps and skips platform-pruned packages', async t => {
  const { missingFromBundle, verifyBundle } = await load();
  const root = fixture(t);
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-bundle-app-'));
  t.after(() => fs.rmSync(app, { recursive: true, force: true }));
  writeManifest(path.join(app, 'node_modules/nested'), { name: 'nested', version: '1.0.0' });
  // linked, sidekick and deep are missing; prunable platform names are expected absences
  const missing = missingFromBundle(root, app).map(item => item.name);
  assert.deepEqual(missing, ['deep', 'linked', 'sidekick']);
  assert.throws(() => verifyBundle(root, app), error => {
    assert.match(error.message, /3 source dependencies are missing/);
    assert.match(error.message, /linked \(via root > linked\)/);
    assert.match(error.message, /electron-builder silently dropped/);
    return true;
  });

  for (const name of ['linked', 'deep', 'sidekick']) {
    writeManifest(path.join(app, 'node_modules', name), { name, version: '1.0.0' });
  }
  const result = verifyBundle(root, app);
  assert.ok(result.checked >= 6, `expected the whole closure, got ${result.checked}`);
  assert.equal(result.missing, 0);
});

test('verifyBundle fails closed without packaged node_modules', async t => {
  const { verifyBundle } = await load();
  const root = fixture(t);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-bundle-empty-'));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  assert.throws(() => verifyBundle(root, empty), /packaged node_modules not found/);
});
