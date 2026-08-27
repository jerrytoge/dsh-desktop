'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const POLICY_PATH = path.join(
  __dirname,
  '..',
  'packages',
  'dsh-agent-communication-policy',
  'lib',
  'policy.js',
);

/** Shared blocker rule every tier must carry. */
const BLOCKER_RULE = /On a blocker \(sandbox denial, missing file, repeated failure\), tell the user immediately/;
/** Shared final-summary rule every tier must carry. */
const SUMMARY_RULE = /End with a concise summary/;

async function loadPolicy() {
  return import(POLICY_PATH);
}

test('policy: exposes section metadata and three tiers', async () => {
  const policy = await loadPolicy();
  assert.equal(policy.SECTION_NAME, 'agent:communication-policy');
  assert.equal(policy.SECTION_ORDER, 40);
  assert.deepEqual(policy.TIERS, ['quiet', 'milestones', 'frequent']);
});

test('policy: every tier is non-empty and carries blocker + summary rules', async () => {
  const policy = await loadPolicy();
  for (const tier of policy.TIERS) {
    const text = policy.renderPolicy(tier);
    assert.ok(text.length > 0, `${tier} should render non-empty text`);
    assert.match(text, BLOCKER_RULE, `${tier} must keep the blocker rule`);
    assert.match(text, SUMMARY_RULE, `${tier} must keep the final-summary rule`);
  }
});

test('policy: milestones tier covers all five observable scenarios', async () => {
  const policy = await loadPolicy();
  const text = policy.renderPolicy('milestones');
  // 1. plan before a complex task
  assert.match(text, /Before starting a complex task.*state your plan/, 'milestones: plan rule');
  // 2. report after first exploration/search round
  assert.match(text, /After the first round of exploration or search.*report what you located/, 'milestones: search-report rule');
  // 3. say what is about to run before tests
  assert.match(text, /Before running tests or verification.*what you are about to run/, 'milestones: pre-test rule');
  // 4. blocker reported immediately
  assert.match(text, BLOCKER_RULE, 'milestones: blocker rule');
  // 5. final summary
  assert.match(text, SUMMARY_RULE, 'milestones: summary rule');
});

test('policy: tiers differ in narration intensity', async () => {
  const policy = await loadPolicy();
  const quiet = policy.renderPolicy('quiet');
  const milestones = policy.renderPolicy('milestones');
  const frequent = policy.renderPolicy('frequent');
  // Frequent demands narration before EVERY tool call; quiet explicitly forbids it.
  assert.match(frequent, /Before each tool call, say in one short sentence/);
  assert.match(quiet, /Do not narrate routine steps; call tools directly/);
  // Milestones sits between: no per-call rule, but has the plan + search rules.
  assert.doesNotMatch(milestones, /Before each tool call/);
  assert.doesNotMatch(quiet, /Before each tool call/);
});

test('policy: unknown tier renders empty', async () => {
  const policy = await loadPolicy();
  assert.equal(policy.renderPolicy('chatty'), '');
});

test('plugin: config resolution defaults to milestones and validates tiers', async () => {
  const plugin = await import(path.join(__dirname, '..', 'packages', 'dsh-agent-communication-policy', 'lib', 'index.js'));
  // No config -> milestones default
  assert.equal(plugin.resolveConfig(undefined), 'milestones');
  assert.equal(plugin.resolveConfig({}), 'milestones');
  const previous = process.env.DSH_DESKTOP_COMMUNICATION_POLICY_TIER;
  process.env.DSH_DESKTOP_COMMUNICATION_POLICY_TIER = 'frequent';
  assert.equal(plugin.resolveConfig({}), 'frequent');
  if (previous === undefined) delete process.env.DSH_DESKTOP_COMMUNICATION_POLICY_TIER;
  else process.env.DSH_DESKTOP_COMMUNICATION_POLICY_TIER = previous;
  // Explicit tiers pass through and override the Desktop setting
  assert.equal(plugin.resolveConfig({ tier: 'quiet' }), 'quiet');
  assert.equal(plugin.resolveConfig({ tier: 'frequent' }), 'frequent');
  // Unknown tiers throw
  assert.throws(() => plugin.resolveConfig({ tier: 'chatty' }), /invalid tier/);
  // Non-string tier throws
  assert.throws(() => plugin.resolveConfig({ tier: 42 }), /invalid tier/);
  // Exports shape matches cordis plugin expectations
  assert.equal(plugin.name, 'agent-communication-policy');
  assert.deepEqual(plugin.inject, ['systemPrompt']);
  assert.equal(typeof plugin.apply, 'function');
  assert.equal(plugin.DEFAULT_TIER, 'milestones');
});
