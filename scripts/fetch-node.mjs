// Fetch the bundled Node runtime (darwin-arm64) used by the packaged app.
//
// The desktop shell ships its own `node/bin/node` so the sidecar `dsh web`
// process runs even on machines without Node on PATH. Rather than committing
// a 138MB binary to git, this script downloads the official Node tarball at
// build time (local or CI).
//
// Usage:
//   node scripts/fetch-node.mjs            # download the version pinned below
//   node scripts/fetch-node.mjs 26.4.0     # download a specific version
//
// Mirrors: set NODE_DIST_URL to override the base, e.g.
//   https://npmmirror.com/mirrors/node

import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// Pin the Node version the packaged app ships. Bump deliberately: it must
// match the `node: ...` assumption in CI (`build` uses this exact tarball).
const DEFAULT_VERSION = '26.4.0';

const version = process.argv[2] || DEFAULT_VERSION;
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`invalid version "${version}" (expected e.g. 26.4.0)`);
  process.exit(1);
}

const arch = 'arm64';
const distUrl = (process.env.NODE_DIST_URL || 'https://nodejs.org/dist').replace(/\/+$/, '');
const base = `node-v${version}-darwin-${arch}`;
const tarball = `${base}.tar.gz`;
const url = `${distUrl}/v${version}/${tarball}`;

const targetDir = join(projectRoot, 'node', 'bin');
const targetBin = join(targetDir, 'node');

async function download(url, dest) {
  console.log(`downloading ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`download failed: ${res.status} ${res.statusText}`);
  }
  const file = createWriteStream(dest);
  const body = res.body;
  for await (const chunk of body) {
    file.write(chunk);
  }
  file.end();
  await new Promise((resolve, reject) => {
    file.on('finish', resolve);
    file.on('error', reject);
  });
}

async function main() {
  const tmp = join(tmpdir(), `dsh-node-${version}`);
  await rm(tmp, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });

  const tarballPath = join(tmp, tarball);
  await mkdir(tmp, { recursive: true });
  await download(url, tarballPath);

  console.log(`extracting ${tarball}`);
  execFileSync('tar', ['-xzf', tarballPath, '-C', tmp]);

  const extracted = join(tmp, base, 'bin', 'node');
  console.log(`installing ${extracted} -> ${targetBin}`);
  await rm(targetBin, { force: true });
  await copy(extracted, targetBin);
  await chmod(targetBin, 0o755);

  await rm(tmp, { recursive: true, force: true });
  console.log(`done: ${targetBin} (v${version} darwin-${arch})`);
}

// stream copy without importing fs/promises copyFile (fine for this size)
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
async function copy(src, dest) {
  await pipeline(createReadStream(src), createWriteStream(dest));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
