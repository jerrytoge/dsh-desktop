'use strict';

// Assisted-update download: the Electron-free half of the in-app updater.
//
// The shell streams a GitHub release asset to disk, verifies the sha256 digest
// GitHub publishes for that asset, and only then exposes the finished file.
// It deliberately does NOT install anything: macOS self-install (Squirrel.Mac)
// requires a Developer ID signature, so the shell opens the verified .dmg and
// the user performs the final drag to /Applications.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

// browser_download_url is served from github.com and the bytes are redirected
// to these hosts. A URL outside this set means the release metadata cannot be
// trusted, so refuse before anything touches the disk.
const TRUSTED_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

function isTrustedUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }
  return url.protocol === 'https:' && TRUSTED_HOSTS.has(url.hostname.toLowerCase());
}

// GitHub reports asset digests as "sha256:<hex>". Older API responses omit the
// field entirely, which is why callers treat it as optional but authoritative.
function parseDigest(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(sha256):([0-9a-f]{64})$/i);
  return match ? { algorithm: match[1].toLowerCase(), hex: match[2].toLowerCase() } : null;
}

// Only arm64 builds are published today. With a single .dmg there is nothing to
// choose; with several, require an arch match rather than silently installing
// the wrong architecture.
function pickDmgAsset(assets, arch) {
  const dmgs = (Array.isArray(assets) ? assets : []).filter(
    (asset) =>
      asset &&
      typeof asset.name === 'string' &&
      /\.dmg$/i.test(asset.name) &&
      typeof asset.browser_download_url === 'string'
  );
  if (!dmgs.length) return null;
  if (dmgs.length === 1) return dmgs[0];
  const wanted = String(arch || '').toLowerCase();
  return dmgs.find((asset) => asset.name.toLowerCase().includes(wanted)) || null;
}

function hashFile(file, algorithm = 'sha256') {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

// Reuses a previously downloaded artefact when it still matches, so a retry
// after a failed mount does not re-download ~170MB.
async function verifyFile(file, { expectedSize, expectedDigest } = {}) {
  let stat;
  try {
    stat = await fs.promises.stat(file);
  } catch {
    return { ok: false, reason: 'missing' };
  }
  if (!stat.isFile()) return { ok: false, reason: 'not-a-file' };
  if (Number.isFinite(expectedSize) && stat.size !== expectedSize) {
    return { ok: false, reason: 'size' };
  }
  const digest = parseDigest(expectedDigest);
  if (digest) {
    const actual = await hashFile(file, digest.algorithm);
    if (actual !== digest.hex) return { ok: false, reason: 'digest' };
  }
  return { ok: true, size: stat.size, verifiedDigest: Boolean(digest) };
}

async function downloadAsset({
  url,
  dest,
  expectedSize,
  expectedDigest,
  onProgress,
  fetchImpl = fetch,
  signal,
} = {}) {
  if (!isTrustedUrl(url)) throw new Error(`Refusing untrusted download URL: ${url}`);
  const digest = parseDigest(expectedDigest);
  const part = `${dest}.part`;
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.rm(part, { force: true });

  const res = await fetchImpl(url, { redirect: 'follow', signal });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  // Redirects are followed, so the final host must be trusted as well.
  if (res.url && !isTrustedUrl(res.url)) {
    throw new Error(`Refusing untrusted redirect target: ${res.url}`);
  }
  if (!res.body) throw new Error('Download failed: empty response body');

  const headerLength = Number(res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : NaN);
  const total = Number.isFinite(expectedSize) ? expectedSize : Number.isFinite(headerLength) ? headerLength : 0;
  const hash = crypto.createHash(digest ? digest.algorithm : 'sha256');
  let received = 0;

  const source = Readable.fromWeb(res.body);
  source.on('data', (chunk) => {
    hash.update(chunk);
    received += chunk.length;
    if (onProgress) onProgress({ received, total });
  });

  try {
    await pipeline(source, fs.createWriteStream(part));
    const actual = hash.digest('hex');
    if (Number.isFinite(expectedSize) && received !== expectedSize) {
      throw new Error(`Size mismatch: expected ${expectedSize} bytes, got ${received}`);
    }
    if (digest && actual !== digest.hex) {
      throw new Error(`Digest mismatch: expected ${digest.algorithm}:${digest.hex}, got ${digest.algorithm}:${actual}`);
    }
    await fs.promises.rename(part, dest);
    return { path: dest, size: received, digest: `sha256:${actual}`, verified: Boolean(digest) };
  } catch (error) {
    // Never leave a partial artefact behind that a later run could mistake for
    // a finished download.
    await fs.promises.rm(part, { force: true });
    throw error;
  }
}

module.exports = {
  TRUSTED_HOSTS,
  isTrustedUrl,
  parseDigest,
  pickDmgAsset,
  hashFile,
  verifyFile,
  downloadAsset,
};
