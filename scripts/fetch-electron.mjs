// Prepare the unpacked Electron distribution required by electron-builder.yml.
//
// pnpm intentionally does not run dependency lifecycle scripts unless allowed,
// so node_modules/electron can exist without its large dist/ payload. The build
// uses electronDist for deterministic, workspace-local packaging; this script
// makes that contract explicit instead of relying on electron's postinstall.

import { createWriteStream } from 'node:fs';
import { access, chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '..');
const electronDir = join(root, 'node_modules', 'electron');
const manifest = JSON.parse(await readFile(join(electronDir, 'package.json'), 'utf8'));
const version = manifest.version;
const platform = process.env.ELECTRON_INSTALL_PLATFORM || process.platform;
const arch = process.env.ELECTRON_INSTALL_ARCH || process.arch;

if (platform !== 'darwin' || arch !== 'arm64') {
  throw new Error(`dsh-desktop currently packages darwin-arm64 Electron, got ${platform}-${arch}`);
}

const distDir = join(electronDir, 'dist');
const executable = join(distDir, 'Electron.app', 'Contents', 'MacOS', 'Electron');
const versionFile = join(distDir, 'version');
const pathFile = join(electronDir, 'path.txt');

async function ready() {
  try {
    const installed = (await readFile(versionFile, 'utf8')).trim().replace(/^v/, '');
    await access(executable);
    return installed === version;
  } catch {
    return false;
  }
}

async function download(url, destination) {
  console.log(`downloading ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`download failed: ${response.status} ${response.statusText}`);
  await pipeline(response.body, createWriteStream(destination));
}

if (await ready()) {
  console.log(`Electron dist ready: ${executable} (v${version})`);
} else {
  const mirror = (process.env.ELECTRON_MIRROR || 'https://github.com/electron/electron/releases/download').replace(/\/$/, '');
  const filename = `electron-v${version}-${platform}-${arch}.zip`;
  const url = `${mirror}/v${version}/${filename}`;
  const work = join(tmpdir(), `dsh-electron-${version}-${platform}-${arch}`);
  const archive = join(work, filename);
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  await download(url, archive);
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  console.log(`extracting ${filename}`);
  execFileSync('/usr/bin/ditto', ['-x', '-k', archive, distDir], { stdio: 'inherit' });
  await access(executable);
  await chmod(executable, 0o755);
  await writeFile(pathFile, 'Electron.app/Contents/MacOS/Electron');
  await rm(work, { recursive: true, force: true });
  console.log(`done: ${executable} (v${version})`);
}
