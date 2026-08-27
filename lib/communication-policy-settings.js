'use strict';

const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const TIERS = ['quiet', 'milestones', 'frequent'];
const DEFAULT_TIER = 'milestones';

function settingsPath(env = process.env) {
  const dshHome = path.resolve(env.DSH_HOME || path.join(os.homedir(), '.dsh'));
  return path.join(dshHome, 'desktop', 'settings.json');
}

function readTierSync(env = process.env) {
  const file = settingsPath(env);
  try {
    const parsed = JSON.parse(fsSync.readFileSync(file, 'utf8'));
    const tier = parsed?.communicationPolicy?.tier;
    return TIERS.includes(tier) ? tier : DEFAULT_TIER;
  } catch {
    return DEFAULT_TIER;
  }
}

function validateTier(tier) {
  if (typeof tier !== 'string' || !TIERS.includes(tier)) {
    throw Object.assign(new Error(`Invalid communication policy tier: ${JSON.stringify(tier)}`), { code: 'INVALID_POLICY_TIER' });
  }
  return tier;
}

async function readSettings(env = process.env) {
  const file = settingsPath(env);
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    const tier = parsed?.communicationPolicy?.tier;
    return { tier: TIERS.includes(tier) ? tier : DEFAULT_TIER, file };
  } catch (error) {
    if (error.code === 'ENOENT') return { tier: DEFAULT_TIER, file };
    if (error instanceof SyntaxError) throw Object.assign(new Error(`Desktop settings are invalid JSON: ${file}`), { code: 'INVALID_DESKTOP_SETTINGS' });
    throw error;
  }
}

async function writeTier(tier, env = process.env) {
  validateTier(tier);
  const file = settingsPath(env);
  let settings = {};
  try {
    settings = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) settings = {};
  } catch (error) {
    if (error.code !== 'ENOENT') {
      if (error instanceof SyntaxError) throw Object.assign(new Error(`Desktop settings are invalid JSON: ${file}`), { code: 'INVALID_DESKTOP_SETTINGS' });
      throw error;
    }
  }
  settings.communicationPolicy = { ...(settings.communicationPolicy || {}), tier };
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  await fs.rename(temp, file);
  return { tier, file, restartRequired: true };
}

module.exports = { TIERS, DEFAULT_TIER, settingsPath, readTierSync, validateTier, readSettings, writeTier };
