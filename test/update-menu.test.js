'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { UPDATE_MENU_ITEM_ID, TRAY_UPDATE_ITEM_ID, buildMenuTemplate, buildTrayMenuTemplate } = require('../lib/update-menu');

const flatten = (template) => template.flatMap((menu) => menu.submenu || []);
const rolesOf = (template) => flatten(template).map((item) => item.role).filter(Boolean);

test('the update entry is always present and carries its handler', () => {
  const clicked = [];
  const template = buildMenuTemplate({ platform: 'darwin', updateLabel: '有新版本 1.2.0…', onCheckForUpdates: () => clicked.push(true) });
  const item = flatten(template).find((entry) => entry.id === UPDATE_MENU_ITEM_ID);

  assert.ok(item, 'the menu must expose the update entry by id');
  assert.equal(item.label, '有新版本 1.2.0…', 'the label is what makes the entry informative');
  item.click();
  assert.equal(clicked.length, 1);
});

test('the entry is reachable on every platform', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    const template = buildMenuTemplate({ platform });
    assert.ok(
      flatten(template).some((entry) => entry.id === UPDATE_MENU_ITEM_ID),
      `missing update entry on ${platform}`
    );
  }
});

test('standard roles survive replacing the default menu', () => {
  // Electron supplies these for free until an app sets its own menu; dropping
  // any of them breaks copy/paste or quitting.
  const roles = rolesOf(buildMenuTemplate({ platform: 'darwin' }));
  for (const role of ['quit', 'copy', 'paste', 'cut', 'selectAll', 'undo', 'toggleDevTools', 'minimize']) {
    assert.ok(roles.includes(role), `${role} role must be preserved`);
  }
  assert.ok(roles.includes('front'), 'macOS window menu uses front, not close');
  assert.ok(!roles.includes('close'), 'macOS apps must not expose a window close role');
});

test('non-macOS builds keep a close role and no app menu', () => {
  const template = buildMenuTemplate({ platform: 'win32' });
  const roles = rolesOf(template);
  assert.ok(roles.includes('close'));
  assert.ok(!roles.includes('front'));
  // No macOS-style application menu, so the first entry is a real menu.
  assert.equal(template[0].label, '编辑');
});

test('a missing handler still produces a valid, non-throwing item', () => {
  const item = flatten(buildMenuTemplate({ platform: 'darwin' })).find((e) => e.id === UPDATE_MENU_ITEM_ID);
  assert.equal(typeof item.click, 'undefined');
});

// The tray is the fix for "I can see there is an update, but what do I click?":
// the menu-bar icon itself only appears when there is something to do, and its
// first real entry performs the update.
test('the tray menu states the version and leads with the action', () => {
  const calls = [];
  const items = buildTrayMenuTemplate({
    current: '0.1.5-rc.1-42',
    latest: '0.1.5-rc.2-44',
    onUpdate: () => calls.push('update'),
    onOpenReleases: () => calls.push('releases'),
    onCheckForUpdates: () => calls.push('check'),
    onQuit: () => calls.push('quit'),
  });

  const labels = items.filter((i) => i.label).map((i) => i.label);
  assert.deepEqual(labels, [
    '有新版本 0.1.5-rc.2-44',
    '当前版本 0.1.5-rc.1-42',
    '立即更新…',
    '前往下载页',
    '检查更新…',
    '退出 DeepSeek Harness',
  ]);

  // The informational rows must not look clickable.
  for (const label of ['有新版本 0.1.5-rc.2-44', '当前版本 0.1.5-rc.1-42']) {
    assert.equal(items.find((i) => i.label === label).enabled, false);
  }

  // The very first actionable entry is the update itself, not a submenu detour.
  const action = items.find((i) => i.id === TRAY_UPDATE_ITEM_ID);
  assert.ok(action, 'the tray must expose the update action by id');
  action.click();
  assert.deepEqual(calls, ['update']);
});

test('every tray entry fires exactly the handler it is given', () => {
  const calls = [];
  const items = buildTrayMenuTemplate({
    current: 'a',
    latest: 'b',
    onUpdate: () => calls.push('update'),
    onOpenReleases: () => calls.push('releases'),
    onCheckForUpdates: () => calls.push('check'),
    onQuit: () => calls.push('quit'),
  });
  for (const item of items) if (item.click) item.click();
  assert.deepEqual(calls, ['update', 'releases', 'check', 'quit']);
});

test('a sparse tray menu still builds without throwing', () => {
  const items = buildTrayMenuTemplate({});
  assert.ok(Array.isArray(items));
  assert.ok(!items.some((i) => i.click), 'no handlers means nothing is clickable');
  assert.ok(items.some((i) => i.id === TRAY_UPDATE_ITEM_ID), 'the action row is unconditional');
});

// Regression: the dropdown kept offering "立即更新…" while a check was running,
// so a click appeared to do nothing but flip a label.
test('the tray reports an in-flight check and disables the action', () => {
  const idle = buildTrayMenuTemplate({ current: 'a', latest: 'b', checking: false });
  assert.ok(!idle.some((i) => i.label === '正在检查更新…'));
  assert.equal(idle.find((i) => i.id === TRAY_UPDATE_ITEM_ID).enabled, true);

  const busy = buildTrayMenuTemplate({ current: 'a', latest: 'b', checking: true });
  const status = busy.find((i) => i.label === '正在检查更新…');
  assert.ok(status, 'the checking state must be visible in the dropdown');
  assert.equal(status.enabled, false);
  assert.equal(busy.find((i) => i.id === TRAY_UPDATE_ITEM_ID).enabled, false, 'do not offer an action that cannot run');
});
