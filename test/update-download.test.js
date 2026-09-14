'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const download = require('../lib/update-download');

function tmpdir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-download-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A real web stream (as fetch would return) plus the fields the shell relies on.
function respond(data, { status = 200, url = '', headers = {} } = {}) {
  const base = new Response(data);
  const merged = new Headers(base.headers);
  for (const [key, value] of Object.entries(headers)) merged.set(key, value);
  return { ok: status >= 200 && status < 300, status, url, headers: merged, body: base.body };
}

const sha256 = (buf) => `sha256:${crypto.createHash('sha256').update(buf).digest('hex')}`;

test('only https URLs on GitHub-controlled hosts are trusted', () => {
  assert.equal(download.isTrustedUrl('https://github.com/o/r/releases/download/v1/a.dmg'), true);
  assert.equal(download.isTrustedUrl('https://objects.githubusercontent.com/x'), true);
  assert.equal(download.isTrustedUrl('https://release-assets.githubusercontent.com/x'), true);
  // A plain-http or lookalike host must never be accepted: the digest cannot
  // protect us if we fetched the attacker's file *and* its claimed digest.
  assert.equal(download.isTrustedUrl('http://github.com/o/r'), false);
  assert.equal(download.isTrustedUrl('https://evil.example.com/a.dmg'), false);
  assert.equal(download.isTrustedUrl('https://github.com.evil.example/a.dmg'), false);
  assert.equal(download.isTrustedUrl('not a url'), false);
  assert.equal(download.isTrustedUrl(undefined), false);
});

test('parseDigest accepts only sha256 hex digests', () => {
  const hex = 'a'.repeat(64);
  assert.deepEqual(download.parseDigest(`sha256:${hex}`), { algorithm: 'sha256', hex });
  assert.deepEqual(download.parseDigest(`SHA256:${'A'.repeat(64)}`), { algorithm: 'sha256', hex });
  assert.equal(download.parseDigest('md5:abc'), null);
  assert.equal(download.parseDigest('sha256:short'), null);
  assert.equal(download.parseDigest(null), null);
  assert.equal(download.parseDigest(undefined), null);
});

test('pickDmgAsset requires an unambiguous architecture match', () => {
  const arm = { name: 'DeepSeek.Harness-0.1.5-rc.2-44-arm64.dmg', browser_download_url: 'https://github.com/a' };
  const x64 = { name: 'DeepSeek.Harness-0.1.5-rc.2-44-x64.dmg', browser_download_url: 'https://github.com/b' };
  const zip = { name: 'DeepSeek.Harness-0.1.5-rc.2-44-arm64-mac.zip', browser_download_url: 'https://github.com/c' };

  // A single .dmg is unambiguous regardless of naming.
  assert.equal(download.pickDmgAsset([zip, arm], 'arm64'), arm);
  assert.equal(download.pickDmgAsset([arm], 'x64'), arm);
  // Several .dmg files: pick the matching arch, never guess another one.
  assert.equal(download.pickDmgAsset([x64, arm], 'arm64'), arm);
  assert.equal(download.pickDmgAsset([x64, arm], 'ia32'), null);
  // No .dmg at all (e.g. a zip-only release) must not silently download a zip.
  assert.equal(download.pickDmgAsset([zip], 'arm64'), null);
  assert.equal(download.pickDmgAsset([], 'arm64'), null);
  assert.equal(download.pickDmgAsset(undefined, 'arm64'), null);
});

test('downloadAsset streams to disk, verifies digest, and reports progress', async t => {
  const dir = tmpdir(t);
  const dest = path.join(dir, 'update.dmg');
  const payload = crypto.randomBytes(256 * 1024);
  const progress = [];

  const result = await download.downloadAsset({
    url: 'https://github.com/jerrytoge/dsh-desktop/releases/download/v1/a.dmg',
    dest,
    expectedSize: payload.length,
    expectedDigest: sha256(payload),
    fetchImpl: async () => respond(payload, { headers: { 'content-length': String(payload.length) } }),
    onProgress: (event) => progress.push(event),
  });

  assert.equal(result.path, dest);
  assert.equal(result.size, payload.length);
  assert.equal(result.verified, true);
  assert.deepEqual(fs.readFileSync(dest), payload);
  // The partial file must never survive a successful download.
  assert.equal(fs.existsSync(`${dest}.part`), false);
  assert.ok(progress.length >= 1, 'progress must be reported');
  assert.equal(progress.at(-1).received, payload.length);
  assert.equal(progress.at(-1).total, payload.length);
});

test('a corrupted payload is rejected and leaves no artefact behind', async t => {
  const dir = tmpdir(t);
  const dest = path.join(dir, 'update.dmg');
  const payload = crypto.randomBytes(4096);

  await assert.rejects(
    download.downloadAsset({
      url: 'https://github.com/o/r/releases/download/v1/a.dmg',
      dest,
      expectedSize: payload.length,
      // Digest of a different payload: same size, wrong bytes.
      expectedDigest: sha256(crypto.randomBytes(4096)),
      fetchImpl: async () => respond(payload),
    }),
    /Digest mismatch/
  );
  assert.equal(fs.existsSync(dest), false);
  assert.equal(fs.existsSync(`${dest}.part`), false);
});

test('size mismatch, HTTP errors and untrusted redirects all fail closed', async t => {
  const dir = tmpdir(t);
  const dest = path.join(dir, 'update.dmg');
  const url = 'https://github.com/o/r/releases/download/v1/a.dmg';

  await assert.rejects(
    download.downloadAsset({ url, dest, expectedSize: 999, fetchImpl: async () => respond(Buffer.from('short')) }),
    /Size mismatch/
  );

  await assert.rejects(
    download.downloadAsset({ url, dest, fetchImpl: async () => respond('nope', { status: 503 }) }),
    /HTTP 503/
  );

  // The release metadata said github.com, but the bytes came from elsewhere.
  await assert.rejects(
    download.downloadAsset({
      url,
      dest,
      fetchImpl: async () => respond(Buffer.from('x'), { url: 'https://evil.example.com/a.dmg' }),
    }),
    /untrusted redirect/
  );

  assert.equal(fs.existsSync(dest), false);
  assert.equal(fs.existsSync(`${dest}.part`), false);
});

test('downloadAsset refuses a URL that was never trusted', async t => {
  const dir = tmpdir(t);
  await assert.rejects(
    download.downloadAsset({
      url: 'https://evil.example.com/a.dmg',
      dest: path.join(dir, 'a.dmg'),
      fetchImpl: async () => assert.fail('must not fetch an untrusted URL'),
    }),
    /untrusted download URL/
  );
});

test('verifyFile lets a valid previous download be reused instead of refetched', async t => {
  const dir = tmpdir(t);
  const file = path.join(dir, 'cached.dmg');
  const payload = crypto.randomBytes(2048);
  fs.writeFileSync(file, payload);
  const meta = { expectedSize: payload.length, expectedDigest: sha256(payload) };

  assert.equal((await download.verifyFile(file, meta)).ok, true);
  assert.equal((await download.verifyFile(path.join(dir, 'absent.dmg'), meta)).reason, 'missing');
  assert.equal((await download.verifyFile(file, { ...meta, expectedSize: 1 })).reason, 'size');
  assert.equal((await download.verifyFile(file, { expectedDigest: sha256(crypto.randomBytes(2048)) })).reason, 'digest');
});

test('the shell wires the assisted flow: prompt, verified download, abort on quit', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  // The prompt must offer the in-app download, not just a link out.
  assert.match(main, /\['下载并安装', '前往下载页', '稍后'\]/);
  assert.match(main, /pickDmgAsset\(info\.assets, process\.arch\)/);
  // Only where a .dmg can actually be opened.
  assert.match(main, /process\.platform === 'darwin' \? pickDmgAsset/);
  // Digest verification and progress must be part of the download call.
  assert.match(main, /expectedDigest[,:]/);
  assert.match(main, /win\.setProgressBar\(/);
  // Self-install stays out of scope: no Squirrel.Mac based installer here.
  assert.doesNotMatch(main, /electron-updater|quitAndInstall|autoUpdater/);
  // Quitting mid-download must abort rather than leave a stale .part file.
  assert.match(main, /before-quit[\s\S]{0,200}updateDownloadAbort\.abort\(\)/);
});
