'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createUpdateTracker, HOUR_MS } = require('../lib/update-state');

const UP_TO_DATE = { current: '1.0.0', latest: '1.0.0', hasUpdate: false };
const AVAILABLE = { current: '1.0.0', latest: '1.1.0', hasUpdate: true };
const NEWER = { current: '1.0.0', latest: '1.2.0', hasUpdate: true };

test('a fresh tracker is due immediately and advertises nothing yet', () => {
  const tracker = createUpdateTracker({ intervalMs: 1000 });
  assert.equal(tracker.state.status, 'idle');
  assert.equal(tracker.isDue(), true, 'the boot check must fall out of the same path');
  assert.equal(tracker.menuLabel(), '检查更新…');
  assert.equal(tracker.badge(), '');
});

test('periodic checks become due exactly once per interval', () => {
  const tracker = createUpdateTracker({ intervalMs: 1000 });
  tracker.record(UP_TO_DATE, 1000);
  assert.equal(tracker.isDue(1000), false);
  assert.equal(tracker.isDue(1999), false);
  assert.equal(tracker.isDue(2000), true);
});

test('the default interval is hours, not minutes', () => {
  const tracker = createUpdateTracker();
  assert.equal(tracker.intervalMs, 6 * HOUR_MS);
});

test('an available update drives the persistent entry (badge + menu label)', () => {
  const tracker = createUpdateTracker();
  tracker.markChecking();
  assert.equal(tracker.menuLabel(), '正在检查更新…');

  const result = tracker.record(AVAILABLE, 10);
  assert.equal(result.shouldPrompt, true, 'the user is told once');
  assert.equal(result.becameAvailable, true);
  assert.equal(tracker.state.status, 'available');
  assert.equal(tracker.badge(), '●', 'the badge must survive dismissing the dialog');
  assert.match(tracker.menuLabel(), /1\.1\.0/);

  tracker.markNotified();
  const again = tracker.record(AVAILABLE, 20);
  assert.equal(again.shouldPrompt, false, 'a periodic check must not nag about the same version');
  assert.equal(again.becameAvailable, false);
  assert.equal(tracker.badge(), '●', 'the entry stays until the user acts');
});

test('a later release re-arms both the dialog and the entry', () => {
  const tracker = createUpdateTracker();
  tracker.record(AVAILABLE, 10);
  tracker.markNotified();
  assert.equal(tracker.record(AVAILABLE, 20).shouldPrompt, false);

  const newer = tracker.record(NEWER, 30);
  assert.equal(newer.shouldPrompt, true);
  assert.equal(newer.becameAvailable, true);
  assert.match(tracker.menuLabel(), /1\.2\.0/);
});

test('being up to date clears the entry', () => {
  const tracker = createUpdateTracker();
  tracker.record(AVAILABLE, 10);
  tracker.markNotified();
  assert.equal(tracker.badge(), '●');

  tracker.record(UP_TO_DATE, 20);
  assert.equal(tracker.state.status, 'current');
  assert.equal(tracker.badge(), '');
  assert.equal(tracker.menuLabel(), '检查更新…');
});

test('a failed check must not hide a known-available update', () => {
  const tracker = createUpdateTracker();
  tracker.record(AVAILABLE, 10);

  tracker.record(null, 20);
  // A transient network error would otherwise drop the badge and lose the
  // user's only passive signal that an update exists.
  assert.equal(tracker.state.hasUpdate, true);
  assert.equal(tracker.badge(), '●');
  assert.equal(tracker.isDue(20), false, 'and it should wait a full interval before retrying');

  const fresh = createUpdateTracker();
  fresh.record(null, 20);
  assert.equal(fresh.state.status, 'error');
  assert.equal(fresh.badge(), '');
  assert.equal(fresh.menuLabel(), '检查更新…');
});

// Regression: clicking the entry used to always re-run the check. Because a
// version is only announced once, shouldPrompt was already false, so the click
// flipped the label to "正在检查更新…" and then did nothing at all.
test('clicking the entry acts on a known update instead of re-checking', () => {
  const tracker = createUpdateTracker();
  assert.equal(tracker.clickAction(), 'check', 'nothing known yet: go and look');

  tracker.markChecking();
  assert.equal(tracker.clickAction(), 'wait', 'a check is already in flight');

  tracker.record(AVAILABLE, 10);
  tracker.markNotified();
  assert.equal(tracker.clickAction(), 'update', 'a known release must be actionable, not re-checked');
});

test('an update is still actionable after the dialog was dismissed', () => {
  const tracker = createUpdateTracker();
  tracker.record(AVAILABLE, 10);
  tracker.markNotified();
  // The user said "later"; the entry has to keep working.
  assert.equal(tracker.record(AVAILABLE, 20).shouldPrompt, false);
  assert.equal(tracker.clickAction(), 'update');
});

test('the shell wires the persistent entry and the periodic timer', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

  // Persistent entry: the menu item's label tracks the tracker, and the Dock
  // badge mirrors it so the signal survives a dismissed dialog.
  assert.match(main, /getMenuItemById\(UPDATE_MENU_ITEM_ID\)/);
  assert.match(main, /item\.label = updateTracker\.menuLabel\(\)/);
  assert.match(main, /Menu\.setApplicationMenu\(/);
  assert.match(main, /buildMenuTemplate\(\{/);
  assert.match(main, /app\.dock\.setBadge\(updateTracker\.badge\(\)\)/);

  // Both entries route through openUpdateEntry, so a click never dead-ends.
  assert.match(main, /function openUpdateEntry\(/);
  assert.match(main, /updateTracker\.clickAction\(\)/);
  assert.equal(
    (main.match(/Promise\.resolve\(openUpdateEntry\(\)\)/g) || []).length,
    2,
    'the app-menu item and the tray item must both act'
  );
  // A manual check must answer even when the version was already announced.
  assert.match(main, /if \(shouldPrompt \|\| manual\) \{/);

  // Periodic checks: coarse tick + due check + unref, started from boot.
  assert.match(main, /function startPeriodicUpdateChecks\(/);
  assert.match(main, /setInterval\([\s\S]{0,240}updateTracker\.isDue\(\)/);
  assert.match(main, /if \(typeof timer\.unref === 'function'\) timer\.unref\(\)/);
  assert.match(main, /startPeriodicUpdateChecks\(\)/);
  assert.match(main, /DSH_UPDATE_INTERVAL_MS/);
  assert.match(main, /Math\.max\(raw, 60 \* 1000\)/, 'a bad env value must not hammer the API');

  // A manual check always answers, and a background arrival reaches the user.
  assert.match(main, /runUpdateCheck\(\{ manual: true \}\)/);
  assert.match(main, /当前已是最新版本/);
  assert.match(main, /new Notification\(/);
  assert.match(main, /Notification\.isSupported\(\)/);
  assert.match(main, /buildApplicationMenu\(\);[\s\S]{0,80}return boot\(\)/);
});

test('the update prompt states versions without download mechanics', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const detail = main.match(/const detail = asset[\s\S]*?;\n/);
  assert.ok(detail, 'the prompt detail must stay a single, reviewable expression');

  assert.match(detail[0], /当前版本：\$\{info\.current\}/);
  assert.match(detail[0], /最新版本：\$\{info\.latest\}/);
  // The download path, size and verification steps are implementation detail:
  // they made the dialog read like a log line instead of a prompt.
  assert.doesNotMatch(detail[0], /将下载/);
  assert.doesNotMatch(detail[0], /asset\.name/);
  assert.doesNotMatch(detail[0], /校验完整性/);
});
