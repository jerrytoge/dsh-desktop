// Pure, dependency-free policy text for dsh-agent-communication-policy.
// Kept separate from the cordis plugin wrapper so the tier text is unit-testable
// without resolving cordis/schemastery.

/** Section name registered in the system prompt. */
export const SECTION_NAME = "agent:communication-policy";
/** Prompt order: after the deployment persona (0) and before plan policy (50). */
export const SECTION_ORDER = 40;

/** Valid static tiers, in ascending narration intensity. */
export const TIERS = ["quiet", "milestones", "frequent"];

/**
 * The observable-behavior contract text for each static tier.
 *
 * Every tier keeps the two rules that matter most for user trust — blockers are
 * reported immediately, and the final reply summarizes — and differs only in
 * how much middle-of-task narration the model is expected to produce.
 *
 * @param tier - the static policy tier.
 * @returns the contract text injected as the section, or '' for unknown tiers.
 */
export function renderPolicy(tier) {
  switch (tier) {
    case "quiet":
      return [
        "Behavior contract (quiet): minimize intermediate narration while staying observable.",
        "1. Do not narrate routine steps; call tools directly and act.",
        "2. On a blocker (sandbox denial, missing file, repeated failure), tell the user immediately: cause, impact, and what you tried or plan to try. Do not wait until the final reply.",
        "3. End with a concise summary: what changed, verification results, and remaining issues.",
      ].join("\n");
    case "milestones":
      return [
        "Behavior contract (milestones): keep the user able to follow your progress.",
        "1. Before starting a complex task (multi-step implementation, investigation, or refactor), state your plan in one or two sentences — what you will inspect or do, and in what order — before calling tools.",
        "2. After the first round of exploration or search, briefly report what you located and what you will do next, then continue.",
        "3. Before running tests or verification, say in one sentence what you are about to run and why.",
        "4. On a blocker (sandbox denial, missing file, repeated failure), tell the user immediately: cause, impact, and what you tried or plan to try. Do not wait until the final reply.",
        "5. End with a concise summary: what changed, verification results, and remaining issues.",
      ].join("\n");
    case "frequent":
      return [
        "Behavior contract (frequent): keep the user informed at every step.",
        "1. Before each tool call, say in one short sentence what you are about to do and why.",
        "2. After each tool result, briefly state what you learned and what you will do next.",
        "3. On a blocker (sandbox denial, missing file, repeated failure), tell the user immediately: cause, impact, and what you tried or plan to try. Do not wait until the final reply.",
        "4. End with a concise summary: what changed, verification results, and remaining issues.",
      ].join("\n");
    default:
      return "";
  }
}
