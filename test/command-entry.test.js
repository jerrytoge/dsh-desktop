'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { inspectCommandEntry, installCommandEntry, removeCommandEntry, renderWrapper } = require('../lib/command-entry');

async function fixture() { return fs.mkdtemp(path.join(os.tmpdir(), 'dsh-desktop-command-')); }

test('installs, inspects, repairs and removes managed wrapper', async () => {
  const homeDir = await fixture();
  const nodePath = path.join(homeDir, "DeepSeek's App", 'node');
  const dshEntry = path.join(homeDir, 'DeepSeek App', 'bin.js');
  let result = await installCommandEntry({ homeDir, nodePath, dshEntry });
  assert.equal(result.action, 'created');
  let status = await inspectCommandEntry({ homeDir, nodePath, dshEntry, env: { PATH: path.join(homeDir, '.local', 'bin') } });
  assert.equal(status.state, 'managed-current'); assert.equal(status.onPath, true);
  result = await installCommandEntry({ homeDir, nodePath, dshEntry }); assert.equal(result.action, 'unchanged');
  result = await removeCommandEntry({ homeDir }); assert.equal(result.action, 'removed');
  status = await inspectCommandEntry({ homeDir }); assert.equal(status.state, 'absent');
});

test('never overwrites or removes foreign command', async () => {
  const homeDir = await fixture(); const bin = path.join(homeDir, '.local', 'bin');
  await fs.mkdir(bin, { recursive: true }); await fs.writeFile(path.join(bin, 'dsh'), '#!/bin/sh\necho foreign\n');
  await assert.rejects(installCommandEntry({ homeDir, nodePath: '/app/node', dshEntry: '/app/dsh.js' }), { code: 'COMMAND_CONFLICT' });
  await assert.rejects(removeCommandEntry({ homeDir }), { code: 'COMMAND_CONFLICT' });
});

test('wrapper preserves argv and quotes paths', () => {
  const script = renderWrapper({ nodePath: "/Applications/DeepSeek's App/node", dshEntry: '/Applications/DeepSeek App/bin.js' });
  assert.match(script, /exec "\$NODE" "\$DSH" "\$@"/);
  assert.match(script, /'"'"'/);
});

test('rejects symlinked command directory', async () => {
  const homeDir = await fixture(); const elsewhere = await fixture();
  await fs.mkdir(path.join(homeDir, '.local')); await fs.symlink(elsewhere, path.join(homeDir, '.local', 'bin'));
  await assert.rejects(installCommandEntry({ homeDir, nodePath: '/app/node', dshEntry: '/app/dsh.js' }), { code: 'UNSAFE_DIRECTORY' });
});
