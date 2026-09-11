const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const load = () => import('../scripts/smoke-packaged.mjs');

function mockLaunch(action) {
  let options;
  const signals = [];
  return {
    get options() { return options; }, signals,
    deps: { platform: 'darwin', graceMs: 0, timeoutMs: 25,
      inspect: () => ({ executable: '/test/App.app/Contents/MacOS/App', version: 'test' }),
      kill: (pid, signal) => signals.push([pid, signal]),
      spawnImpl: (executable, args, opts) => {
        assert.equal(executable, '/test/App.app/Contents/MacOS/App');
        assert.deepEqual(args, []); options = opts;
        const child = new EventEmitter(); child.pid = 12345;
        child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
        setImmediate(() => action(child)); return child;
      },
    },
  };
}

test('smoke environment removes inherited launch overrides and isolates all homes', async () => {
  const { smokeEnv } = await load();
  const env = smokeEnv('/fresh', { DSH_BIN: '/other', DSH_NODE: '/other', DSH_PORT: '1',
    DSH_WEB_URL: 'http://active', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--require evil',
    HOME: '/real', PATH: '/custom', XDG_CONFIG_HOME: '/real', npm_config_prefix: '/real' });
  for (const key of ['DSH_BIN', 'DSH_NODE', 'DSH_PORT', 'DSH_WEB_URL', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'npm_config_prefix'])
    assert.equal(env[key], undefined);
  assert.equal(env.HOME, '/fresh/home'); assert.equal(env.DSH_HOME, '/fresh/dsh');
  assert.equal(env.DSH_SMOKE_USER_DATA, '/fresh/electron'); assert.equal(env.DSH_SMOKE, '1');
});

test('successful packaged launch requires marker and exit zero; cleans process group and temp dirs', async () => {
  const { runSmoke } = await load();
  const mock = mockLaunch(child => { child.stdout.emit('data', '[dsh-desktop] SMOKE_'); child.stdout.emit('data', 'OK\n'); child.emit('exit', 0, null); });
  assert.equal((await runSmoke('app', mock.deps)).version, 'test');
  assert.equal(mock.options.detached, true);
  assert.equal(fs.existsSync(mock.options.env.HOME), false);
  assert.deepEqual(mock.signals, [[-12345, 'SIGTERM'], [-12345, 'SIGKILL']]);
});

for (const [label, action] of [
  ['no readiness marker', child => child.emit('exit', 0, null)],
  ['nonzero exit after marker', child => { child.stdout.emit('data', '[dsh-desktop] SMOKE_OK\n'); child.emit('exit', 1, null); }],
  ['deadline', () => {}],
  ['spawn error', child => child.emit('error', new Error('spawn failed'))],
]) test(`smoke rejects ${label} and cleans up`, async () => {
  const { runSmoke } = await load(); const mock = mockLaunch(action);
  await assert.rejects(runSmoke('app', mock.deps));
  assert.deepEqual(mock.signals, [[-12345, 'SIGTERM'], [-12345, 'SIGKILL']]);
  assert.equal(fs.existsSync(mock.options.env.HOME), false);
});

test('main isolates userData before lock and does not equate page load with readiness', () => {
  const source = fs.readFileSync(require.resolve('../main.js'), 'utf8');
  assert.ok(source.indexOf("app.setPath('userData'") < source.indexOf('const gotLock'));
  assert.match(source, /if \(SMOKE && process.env.DSH_SMOKE_USER_DATA\)/);
  assert.match(source, /waitForSmokeUi\(win.webContents\)\.then/);
  assert.match(source, /style\[data-plugin-css="dsh-desktop-settings"\]/);
  assert.match(source, /window.dshDesktop.communicationPolicy.get\(\)/);
  const sidecarSpawn = source.slice(source.indexOf('const child = spawn'), source.indexOf("child.stdout.on"));
  assert.doesNotMatch(sidecarSpawn, /detached:\s*true/);
});

test('non-macOS fails before inspecting or spawning', async () => {
  const { runSmoke } = await load();
  await assert.rejects(runSmoke('app', { platform: 'linux', inspect: () => { throw new Error('unexpected inspect'); } }), /requires macOS/);
});
