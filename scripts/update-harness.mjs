#!/usr/bin/env node
/**
 * node scripts/update-harness.mjs <version> [--bypass-release-age] [--registry URL]
 * node scripts/update-harness.mjs --check [version]
 * Requires installed repo dependencies; --check is offline and never writes.
 * Install failures preserve edited manifests for diagnosis/retry and propagate status.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const semver = require('semver');
const yaml = require('js-yaml');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
export const isHarness = name => /^@deepseek-ai\/dsh(?:$|-)/.test(name);
const exactAllowance = key => key.match(/^(@deepseek-ai\/dsh(?:-[^@]+)?)@([^@]+)$/);
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const loadYAML = file => yaml.load(fs.readFileSync(file, 'utf8'));

export function parseArgs(args) {
  const options = { check: false, bypassReleaseAge: false, registry: 'https://registry.npmjs.org' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--check') options.check = true;
    else if (arg === '--bypass-release-age') options.bypassReleaseAge = true;
    else if (arg === '--registry') {
      options.registry = args[++i];
      if (!options.registry) throw new Error('--registry requires a URL');
    } else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else if (options.target) throw new Error('Only one explicit target version is allowed');
    else options.target = arg;
  }
  if (!options.check && !options.target) throw new Error('An explicit target version is required');
  if (options.target && semver.valid(options.target) !== options.target) throw new Error('Target must be an exact canonical semver version');
  const url = new URL(options.registry);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Registry must be an HTTPS URL without credentials');
  if (options.check && options.bypassReleaseAge) throw new Error('--bypass-release-age does not apply to offline --check');
  return options;
}

export function readProject(root) {
  const policy = loadYAML(path.join(root, 'pnpm-workspace.yaml'));
  // Fail closed if workspace topology changes rather than silently omit manifests.
  if (!Array.isArray(policy.packages) || policy.packages.length !== 1 || policy.packages[0] !== 'packages/*') {
    throw new Error('Updater supports the current packages/* workspace layout only');
  }
  const manifests = [{ id: '.', file: path.join(root, 'package.json') }];
  for (const entry of fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) throw new Error(`Refusing symlinked workspace package: ${entry.name}`);
    if (entry.isDirectory()) {
      const file = path.join(root, 'packages', entry.name, 'package.json');
      if (fs.existsSync(file)) manifests.push({ id: `packages/${entry.name}`, file });
    }
  }
  for (const item of manifests) item.data = readJSON(item.file);
  return { root, manifests, policy };
}

export function synchronize(data, target, isRoot) {
  const result = structuredClone(data);
  if (isRoot) result.version = target;
  for (const section of SECTIONS) {
    for (const name of Object.keys(result[section] || {})) {
      if (isHarness(name)) result[section][name] = `^${target}`;
    }
  }
  if (result.allowScripts) {
    const entries = {};
    for (const [key, value] of Object.entries(result.allowScripts)) {
      const match = exactAllowance(key);
      const next = match && semver.valid(match[2]) ? `${match[1]}@${target}` : key;
      if (Object.hasOwn(entries, next) && entries[next] !== value) throw new Error(`Conflicting script allowances for ${next}`);
      entries[next] = value;
    }
    result.allowScripts = entries;
  }
  return result;
}

export function lockPackages(lock) {
  const result = new Map();
  for (const key of Object.keys(lock.packages || {})) {
    const match = key.match(/^(@deepseek-ai\/dsh(?:-[^@]+)?)@([^()]+)(?:\(.*)?$/);
    if (match) {
      if (!result.has(match[1])) result.set(match[1], new Set());
      result.get(match[1]).add(match[2]);
    }
  }
  return result;
}

export function checkConsistency(project, target, lock) {
  const errors = [];
  if (semver.valid(target) !== target) return ['Root/target version is not canonical semver'];
  if (project.manifests[0].data.version !== target) errors.push(`Root version must be ${target}`);
  const locked = lockPackages(lock);
  if (!locked.size) errors.push('Lockfile has no Harness packages');
  for (const [name, versions] of locked) {
    if (versions.size !== 1 || !versions.has(target)) errors.push(`Lockfile ${name}: expected only ${target}, got ${[...versions]}`);
  }
  for (const { id, data } of project.manifests) {
    const importer = lock.importers?.[id];
    if (!importer) errors.push(`Missing lockfile importer: ${id}`);
    for (const section of SECTIONS) {
      for (const [name, range] of Object.entries(data[section] || {})) {
        if (!isHarness(name)) continue;
        if (range !== `^${target}`) errors.push(`${id} ${section} ${name}: expected ^${target}, got ${range}`);
        // pnpm places auto-installed workspace peers in importer.dependencies.
        const entry = importer?.[section]?.[name] || (section === 'peerDependencies' ? importer?.dependencies?.[name] : undefined);
        if (!entry || entry.specifier !== range || String(entry.version).split('(')[0] !== target) {
          errors.push(`${id} lockfile importer does not match ${name}`);
        }
        if (!locked.get(name)?.has(target)) errors.push(`${name}@${target} missing from lockfile packages`);
      }
    }
    for (const key of Object.keys(data.allowScripts || {})) {
      const match = exactAllowance(key);
      if (match && semver.valid(match[2]) && match[2] !== target) errors.push(`${id} stale exact allowScripts entry: ${key}`);
    }
  }
  return errors;
}

export async function validatePublished(names, target, { fetchImpl = fetch, now = Date.now(), bypassReleaseAge = false, registry = 'https://registry.npmjs.org' } = {}) {
  const queue = [...new Set(names)], checked = new Set();
  for (let index = 0; index < queue.length; index++) {
    const name = queue[index];
    if (checked.has(name)) continue;
    checked.add(name);
    const response = await fetchImpl(`${registry.replace(/\/$/, '')}/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Registry HTTP ${response.status}: ${name}`);
    const metadata = await response.json();
    const manifest = metadata.versions?.[target];
    if (!manifest) throw new Error(`${name}@${target} is not published`);
    const published = Date.parse(metadata.time?.[target]);
    if (!Number.isFinite(published)) throw new Error(`Missing publication time for ${name}@${target}`);
    if (published > now) throw new Error(`Future publication time for ${name}@${target}`);
    if (!bypassReleaseAge && now - published < 48 * 3600000) throw new Error(`${name}@${target} is less than 48h old; retry later or explicitly use --bypass-release-age`);
    // Include new transitive packages, including peer and optional dependencies.
    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [dependency, range] of Object.entries(manifest[section] || {})) {
        if (!isHarness(dependency)) continue;
        if (!semver.satisfies(target, range)) throw new Error(`${name}@${target} requires ${dependency}@${range}, incompatible with synchronized target`);
        if (!checked.has(dependency)) queue.push(dependency);
      }
    }
  }
  return [...checked].sort();
}

export function installWithPnpm(root) {
  // Use the same Node for pnpm and lifecycle scripts, even when Node is absent on PATH.
  const bundledPnpm = path.join(root, 'node_modules/pnpm/bin/pnpm.cjs');
  const command = fs.existsSync(bundledPnpm) ? process.execPath : 'pnpm';
  const args = fs.existsSync(bundledPnpm) ? [bundledPnpm, 'install'] : ['install'];
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false,
    env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}` } });
  if (result.error) throw result.error;
  if (result.signal) {
    const error = new Error(`pnpm install terminated by ${result.signal}; manifests remain updated`);
    error.exitCode = 1;
    throw error;
  }
  if (result.status !== 0) {
    const error = new Error(`pnpm install failed (${result.status}); manifests remain updated for diagnosis/retry`);
    error.exitCode = result.status || 1;
    throw error;
  }
}

export async function run(options, { root = ROOT, fetchImpl = fetch, now = Date.now(), install = installWithPnpm, log = console.log } = {}) {
  const project = readProject(root);
  const target = options.target || project.manifests[0].data.version;
  if (semver.valid(target) !== target) throw new Error('Target must be an exact canonical semver version');
  const lockFile = path.join(root, 'pnpm-lock.yaml');
  const before = loadYAML(lockFile);
  if (options.check) {
    const errors = checkConsistency(project, target, before);
    if (errors.length) throw new Error(`Harness consistency check failed:\n${errors.join('\n')}`);
    log(`Harness ${target}: manifests and lockfile are consistent (offline check).`);
    return;
  }
  const names = new Set(['@deepseek-ai/dsh']);
  for (const { data } of project.manifests) {
    for (const section of SECTIONS) for (const name of Object.keys(data[section] || {})) if (isHarness(name)) names.add(name);
    for (const key of Object.keys(data.allowScripts || {})) {
      const match = exactAllowance(key);
      if (match && semver.valid(match[2])) names.add(match[1]);
    }
  }
  const checked = await validatePublished(names, target, { ...options, fetchImpl, now });
  log(`Validated ${checked.length} published Harness packages; release age: ${options.bypassReleaseAge ? 'EXPLICITLY BYPASSED' : 'at least 48h'}.`);
  // Compute every edit before writing; registry/preflight failures leave all files intact.
  const updates = project.manifests.map(item => ({ ...item, next: synchronize(item.data, target, item.id === '.') }));
  for (const item of updates) {
    if (JSON.stringify(item.data) !== JSON.stringify(item.next)) fs.writeFileSync(item.file, `${JSON.stringify(item.next, null, 2)}\n`);
  }
  await install(root);
  const after = loadYAML(lockFile);
  const errors = checkConsistency(readProject(root), target, after);
  if (errors.length) throw new Error(`Post-install consistency check failed:\n${errors.join('\n')}`);
  const oldNames = lockPackages(before), newNames = lockPackages(after);
  log(`Added Harness packages: ${[...newNames.keys()].filter(n => !oldNames.has(n)).sort().join(', ') || '(none)'}`);
  log(`Removed Harness packages: ${[...oldNames.keys()].filter(n => !newNames.has(n)).sort().join(', ') || '(none)'}`);
  log(`Harness updated to ${target}. Review manifests, lockfile and any pnpm policy changes before committing.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await run(parseArgs(process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = error.exitCode || 1; }
}
