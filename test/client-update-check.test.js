'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('personal plugin client starts and reuses silent update checks', () => {
  const client = fs.readFileSync(path.join(__dirname, '..', 'packages', 'dsh-client-ui-settings-desktop', 'lib', 'client.js'), 'utf8');
  assert.match(client, /UPDATE_TTL=10\*60\*1000/);
  assert.match(client, /if\(backgroundApi\)setTimeout\(\(\)=>fetchUpdates\(backgroundApi,false\)\.catch\(\(\)=>\{\}\),0\)/);
  assert.match(client, /if\(updatePromise\)return updatePromise/);
  assert.match(client, /fetchUpdates\(api,false\)/);
  assert.match(client, /fetchUpdates\(api,true\)/);
  assert.match(client, /invalidateUpdates\(\)/);
  assert.doesNotMatch(client, /正在后台检查个人插件更新/);
  assert.match(client, /checking\?"正在检查…":"检查更新"/);
  // After a successful install/update/remove, re-check (not just reload the
  // list) so the other plugins keep their update status.
  assert.match(client, /next\.state==="succeeded"\)\{invalidateUpdates\(\)/);
  assert.match(client, /var data=await fetchUpdates\(api,true\)/);
  // Toggling enable/disable must not wipe the cached update statuses.
  assert.doesNotMatch(client, /setEnabled\(plugin\.packageName,enabled\)\);invalidateUpdates\(\)/);
});
