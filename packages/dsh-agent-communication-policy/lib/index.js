// dsh-agent-communication-policy: unify observable agent behavior across models.
//
// Different models (DeepSeek vs GPT/Codex) under the same harness default to
// different middle-of-task narration: some narrate plans, search findings,
// pre-test intent, and blockers; others silently chain tool calls. Rather than
// branching on the model, this plugin injects one shared "behavior contract"
// prompt section so every model satisfies the same observable rules.
//
// The tier is static configuration, not a dynamic setting: choosing a tier is
// a deployment decision, and the rendered contract text is constant per tier.
// Nothing here changes the agent loop, adapters, UI, or session events.
//
// This module deliberately imports NO third-party packages at runtime: the
// desktop shell loads `@local/*` plugins through a symlink, and ESM resolves
// the real path before walking node_modules, so a runtime import here would
// break under that layout. Config validation is hand-rolled (plan-mode style).
import { SECTION_NAME, SECTION_ORDER, TIERS, renderPolicy } from "./policy.js";

export const name = "agent-communication-policy";
export const inject = ["systemPrompt"];

export { SECTION_NAME, SECTION_ORDER, TIERS, renderPolicy } from "./policy.js";

/** Default static tier when config omits it. */
export const DEFAULT_TIER = "milestones";

/**
 * Validate the plugin config and return the resolved tier.
 * @param config - raw config from the patch row (may be undefined/partial).
 * @returns the resolved tier.
 */
export function resolveConfig(config) {
  const configured = config && typeof config === "object" ? config.tier : undefined;
  const raw = configured === undefined ? process.env.DSH_DESKTOP_COMMUNICATION_POLICY_TIER : configured;
  if (raw === undefined) return DEFAULT_TIER;
  if (typeof raw !== "string" || !TIERS.includes(raw)) {
    throw new Error(
      `dsh-agent-communication-policy: invalid tier ${JSON.stringify(raw)} — expected one of ${TIERS.join(", ")}`,
    );
  }
  return raw;
}

export function apply(ctx, config) {
  const tier = resolveConfig(config);
  const sectionText = renderPolicy(tier);
  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: sectionText,
  });
  ctx.logger.debug(
    "dsh-agent-communication-policy: registered section %s (tier %s, order %s)",
    SECTION_NAME,
    tier,
    SECTION_ORDER,
  );
}

export default { name, inject, apply };
