#!/usr/bin/env node
// Fails when the packaged app is missing a production dependency that exists
// in the source tree. electron-builder's pnpm collector can silently drop
// transitive packages (deduped/peer-ambiguous entries) without any warning;
// the top-level prune check and the smoke's direct-dependency resolution both
// miss that class, so verify the whole reachable closure instead.
// Usage: node scripts/verify-bundle.mjs [rootDir] [appPath]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isPrunable } = require('./after-pack.cjs');

const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const SECTIONS = ['dependencies', 'optionalDependencies'];

// Node's own lookup: a pnpm package's dependencies are siblings inside the
// virtual store (…/.pnpm/<pkg>/node_modules/<dep>), not nested under the
// package directory, so walk ancestors exactly like the resolver does.
function resolveDep(fromDir, name) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Production dependency closure of the workspace: every package directory the
// app could require at runtime, resolved exactly the way Node resolves it
// (realpath-based walk through node_modules links). Optional dependencies are
// included only when they exist on disk — matching install-time behaviour.
export function sourceClosure(root) {
  const visited = new Set();
  const names = new Map();
  const queue = [{ dir: root, label: 'root' }];
  const packagesDir = path.join(root, 'packages');
  if (fs.existsSync(packagesDir)) {
    for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) queue.push({ dir: path.join(packagesDir, entry.name), label: entry.name });
    }
  }
  while (queue.length) {
    const { dir, label } = queue.pop();
    let real;
    try { real = fs.realpathSync(dir); } catch { continue; }
    if (visited.has(real)) continue;
    visited.add(real);
    const manifestFile = path.join(real, 'package.json');
    if (!fs.existsSync(manifestFile)) continue;
    let manifest;
    try { manifest = readJSON(manifestFile); } catch { continue; }
    for (const section of SECTIONS) {
      for (const name of Object.keys(manifest[section] || {})) {
        const depDir = resolveDep(real, name);
        if (!depDir) continue; // platform-skipped or absent optional
        if (!names.has(name)) names.set(name, `${label} > ${name}`);
        queue.push({ dir: depDir, label: `${label} > ${name}` });
      }
    }
  }
  return names;
}

// Names in the source closure that have no counterpart in the packaged app.
// Platform-pruned packages (afterPack rules + electron-builder's platform
// optionals) are expected absences and must not be reported.
export function missingFromBundle(root, appDir) {
  const appModules = path.join(appDir, 'node_modules');
  const missing = [];
  for (const [name, via] of [...sourceClosure(root)].sort(([a], [b]) => a.localeCompare(b))) {
    if (isPrunable(name)) continue;
    if (!fs.existsSync(path.join(appModules, name))) missing.push({ name, via });
  }
  return missing;
}

export function verifyBundle(root, appDir) {
  if (!fs.existsSync(path.join(appDir, 'node_modules'))) {
    throw new Error(`packaged node_modules not found: ${path.join(appDir, 'node_modules')}`);
  }
  const closure = sourceClosure(root);
  const missing = missingFromBundle(root, appDir);
  if (missing.length) {
    const detail = missing.map(item => `  ${item.name} (via ${item.via})`).join('\n');
    throw new Error(`${missing.length} source dependencies are missing from the packaged app:\n${detail}\n`
      + 'electron-builder silently dropped them; declare them as direct dependencies or fix the collector input.');
  }
  return { checked: closure.size, missing: 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = path.resolve(process.argv[2] || '.');
    const app = path.resolve(process.argv[3] || path.join('dist', 'mac-arm64', 'DeepSeek Harness.app', 'Contents', 'Resources', 'app'));
    const result = verifyBundle(root, app);
    console.log(`Bundle closure verified: ${result.checked} production dependencies present in ${path.basename(app)}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
