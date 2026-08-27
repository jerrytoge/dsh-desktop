'use strict';

const os = require('node:os');
const { PersonalPluginManager } = require('./profile-manager');
const { inspectCommandEntry, installCommandEntry, removeCommandEntry } = require('./command-entry');
const { resolveDshEntry, resolvePnpmEntry } = require('./runtime-tools');
const { readSettings: readCommunicationPolicy, writeTier: writeCommunicationPolicyTier } = require('./communication-policy-settings');

function errorPayload(error) {
  return { ok: false, error: { code: error.code || 'DESKTOP_ERROR', message: error.message || String(error), ...(error.state ? { state: error.state } : {}) } };
}

function createDesktopServices({ appDir, resourcesPath, isPackaged, nodePath, env = process.env, homeDir = os.homedir(), onRestart }) {
  const dshEntry = resolveDshEntry(appDir);
  const pnpmEntry = resolvePnpmEntry(appDir, resourcesPath, isPackaged);
  const plugins = new PersonalPluginManager({ nodePath, pnpmEntry, env });
  const operations = new Map();

  function startOperation(kind, work) {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    const operation = { id, kind, state: 'running', lines: [], startedAt: new Date().toISOString() };
    operations.set(id, operation);
    const log = ({ kind: stream, text }) => {
      operation.lines.push({ stream, text, at: new Date().toISOString() });
      if (operation.lines.length > 500) operation.lines.shift();
    };
    Promise.resolve().then(() => work(log)).then((result) => {
      Object.assign(operation, { state: 'succeeded', result, finishedAt: new Date().toISOString() });
    }, (error) => {
      Object.assign(operation, { state: 'failed', error: errorPayload(error).error, finishedAt: new Date().toISOString() });
      if (error.result?.lines) operation.lines.push(...error.result.lines.map((line) => ({ stream: line.kind, text: line.text, at: line.at })));
    });
    return { id, kind, state: 'running' };
  }

  return {
    metadata: { dshEntry, pnpmEntry, nodePath },
    async invoke(method, payload = {}) {
      try {
        switch (method) {
          case 'plugins.list': return { ok: true, value: await plugins.list() };
          case 'plugins.checkUpdates': return { ok: true, value: await plugins.checkUpdates() };
          case 'plugins.install': return { ok: true, value: startOperation('install', (log) => plugins.install(payload.spec, log)) };
          case 'plugins.update': return { ok: true, value: startOperation('update', (log) => plugins.update(payload.name, payload.version, log)) };
          case 'plugins.setEnabled': return { ok: true, value: await plugins.setEnabled(payload.name, payload.enabled) };
          case 'plugins.remove': return { ok: true, value: startOperation('remove', (log) => plugins.remove(payload.name, log)) };
          case 'operations.get': {
            const operation = operations.get(payload.id);
            if (!operation) throw Object.assign(new Error('Operation not found'), { code: 'OPERATION_NOT_FOUND' });
            return { ok: true, value: operation };
          }
          case 'command.status': return { ok: true, value: await inspectCommandEntry({ homeDir, nodePath, dshEntry, env }) };
          case 'command.install': return { ok: true, value: await installCommandEntry({ homeDir, nodePath, dshEntry }) };
          case 'command.remove': return { ok: true, value: await removeCommandEntry({ homeDir }) };
          case 'communicationPolicy.get': return { ok: true, value: await readCommunicationPolicy(env) };
          case 'communicationPolicy.setTier': return { ok: true, value: await writeCommunicationPolicyTier(payload.tier, env) };
          case 'sidecar.restart': await onRestart?.(); return { ok: true, value: { restarted: true } };
          default: throw Object.assign(new Error(`Unknown Desktop method: ${method}`), { code: 'METHOD_NOT_FOUND' });
        }
      } catch (error) { return errorPayload(error); }
    },
  };
}

module.exports = { createDesktopServices, errorPayload };
