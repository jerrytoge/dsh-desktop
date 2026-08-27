'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_TIER, readTierSync, readSettings, writeTier } = require('../lib/communication-policy-settings');

test('communication policy settings default to milestones', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-policy-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const env = { DSH_HOME: home };
  assert.equal((await readSettings(env)).tier, DEFAULT_TIER);
  assert.equal(readTierSync(env), DEFAULT_TIER);
});

test('communication policy settings persist a valid tier without discarding other settings', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-policy-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const env = { DSH_HOME: home };
  const file = path.join(home, 'desktop', 'settings.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ existing: true }));
  const result = await writeTier('frequent', env);
  assert.equal(result.restartRequired, true);
  assert.equal((await readSettings(env)).tier, 'frequent');
  assert.equal(readTierSync(env), 'frequent');
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).existing, true);
});

test('communication policy settings reject unknown tiers', async () => {
  await assert.rejects(() => writeTier('chatty', { DSH_HOME: os.tmpdir() }), { code: 'INVALID_POLICY_TIER' });
});
