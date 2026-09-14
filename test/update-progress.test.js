'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const progress = require('../lib/update-progress');

test('formatBytes switches units and never divides by a non-number', () => {
  assert.equal(progress.formatBytes(0), '0 MB');
  assert.equal(progress.formatBytes(NaN), '0 MB');
  assert.equal(progress.formatBytes(undefined), '0 MB');
  assert.equal(progress.formatBytes(512 * 1024), '512 KB');
  assert.equal(progress.formatBytes(179170647), '170.9 MB');
  assert.equal(progress.formatBytes(3 * 1024 * 1024 * 1024), '3.00 GB');
});

test('formatProgress reports percent, throughput and ETA without exceeding bounds', () => {
  const MB = 1024 * 1024;
  const startedAt = 1000;
  const now = 11000; // 10s elapsed

  const half = progress.formatProgress({ received: 50 * MB, total: 100 * MB, startedAt, now });
  assert.equal(half.percent, 50);
  assert.match(half.detail, /50\.0 MB \/ 100\.0 MB/);
  assert.match(half.detail, /5\.0 MB\/s/, 'throughput must be shown');
  assert.match(half.detail, /约剩 10 秒/, 'an ETA must be shown while bytes remain');
  assert.ok(half.etaSeconds > 0);

  // A total we do not know yet must not produce NaN% or a bogus ETA.
  const unknown = progress.formatProgress({ received: 1024, total: 0, startedAt, now });
  assert.equal(unknown.percent, 0);
  assert.match(unknown.detail, /未知大小/);
  assert.equal(unknown.etaSeconds, null);

  // Overshoot clamps, and a finished transfer has no ETA.
  const overshoot = progress.formatProgress({ received: 200 * MB, total: 100 * MB, startedAt, now });
  assert.equal(overshoot.percent, 100);
  assert.equal(overshoot.etaSeconds, null);
});

test('formatDuration reads as a human ETA', () => {
  assert.equal(progress.formatDuration(0), '0 秒');
  assert.equal(progress.formatDuration(45), '45 秒');
  assert.equal(progress.formatDuration(90), '1 分 30 秒');
  assert.equal(progress.formatDuration(3700), '1 小时 1 分');
});

test('the progress page is self-contained and hostile input cannot escape it', () => {
  const html = progress.buildProgressHtml({ version: '0.1.5-rc.2-44' });
  assert.match(html, /window\.__setProgress/);
  assert.match(html, /id="cancel"/);
  assert.ok(html.includes(progress.CANCEL_URL), 'cancel must route through the intercepted URL');
  // No nodeIntegration/IPC surface and no remote content to fetch.
  assert.doesNotMatch(html, /require\(|ipcRenderer|nodeIntegration/);
  assert.doesNotMatch(html, /https?:\/\//);

  // The version comes from a GitHub tag, so it must never be interpolated raw.
  const evil = progress.buildProgressHtml({ version: '<img src=x onerror="alert(1)">' });
  assert.doesNotMatch(evil, /<img/);
  assert.match(evil, /&lt;img/);
});

test('dark-mode overrides come after the base rules they must beat', () => {
  const html = progress.buildProgressHtml({ version: '0.1.5-rc.2-44' });
  const mediaAt = html.indexOf('@media (prefers-color-scheme: dark)');
  assert.ok(mediaAt > 0, 'the dark block must exist');

  // Regression: the dark rules were declared first and share specificity with
  // the base rules, so the light values silently won — a white button with
  // near-white text. Only the ordering makes the override effective.
  const before = html.slice(0, mediaAt);
  assert.ok(before.includes('.track {'), 'base .track must be declared before the override');
  assert.ok(before.includes('button {'), 'base button must be declared before the override');

  const after = html.slice(mediaAt);
  assert.ok(after.includes('.track { background: #3a3a3c'), 'dark track colour must live in the override block');
  assert.ok(after.includes('button { background: #2c2c2e'), 'dark button colour must live in the override block');
});

test('the shell shows a real progress window instead of relying on the Dock alone', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  // The window is created and driven by the download flow.
  assert.match(main, /function createUpdateProgressWindow\(/);
  assert.match(main, /progress\.paint\(/);
  assert.match(main, /progress\.close\(\)/);
  // The cancel URL from the page must abort the transfer.
  assert.match(main, /startsWith\(CANCEL_URL\)[\s\S]{0,120}requestCancel\(\)/);
  assert.match(main, /updateDownloadAbort\.abort\(\)/);
  // Closing the window is a cancel, but a deliberate close must not abort.
  assert.match(main, /on\('closed'[\s\S]{0,120}if \(!dismissed\) requestCancel\(\)/);
  assert.match(main, /dismissed = true/);
  // Cancel gets a definitive end state rather than silently doing nothing.
  assert.match(main, /update download cancelled by user/);
});
