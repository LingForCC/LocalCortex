/**
 * Stop-condition evaluation — decides whether a rule should be disabled after a
 * run, and why.
 *
 * Spec: docs/architecture.md §6.6, rule-config-schema.md §7.
 *
 * Two complementary mechanisms:
 *  1. Agent-signaled completion: the parsed status block (active|done|error).
 *     `done`/`error` → disable.
 *  2. Structural backstops: `maxRuns` (global default if unset) and `expiresAt`.
 *
 * Manual override always wins (handled outside this module: the user can
 * re-enable any rule).
 *
 * Pure logic — no `electron` import, unit-testable.
 */

import type { ParsedStatus, RuleStatus } from '@shared/types';
import { DEFAULT_MAX_RUNS } from '@shared/constants';

export interface StopCheckInput {
  /** The status block parsed from the agent's output, or null if absent. */
  parsedStatus: ParsedStatus | null;
  /** The rule's run count AFTER this run. */
  runCount: number;
  /** The rule's per-run limit, or null/undefined for "use global default". */
  maxRuns?: number | null;
  /** The rule's expiry timestamp (ISO), or undefined. */
  expiresAt?: string;
  /** Global default maxRuns (used when the rule's own maxRuns is null/undefined). */
  globalMaxRuns?: number;
  /** Override `now` for deterministic tests. */
  now?: () => Date;
}

export interface StopDecision {
  /** Whether the rule should be disabled. */
  shouldDisable: boolean;
  /** The reason recorded alongside the disable (if disabling). */
  reason?: string;
}

/**
 * Evaluate whether a rule should be disabled after a run.
 *
 * Priority (whichever triggers first disables):
 *   1. parsedStatus.status === 'done'  → disable "agent signaled done"
 *   2. parsedStatus.status === 'error' → disable "agent error: <reason>"
 *   3. expiresAt in the past           → disable "expired at <iso>"
 *   4. runCount >= effectiveMaxRuns    → disable "max runs reached (<n>)"
 *
 * `active` status (or no parsed status) keeps the rule running, UNLESS a
 * structural backstop fires.
 */
export function evaluateStop(input: StopCheckInput): StopDecision {
  const { parsedStatus, runCount, expiresAt } = input;
  const now = typeof input.now === 'function' ? input.now() : new Date();

  if (parsedStatus && (parsedStatus.status === 'done' || parsedStatus.status === 'error')) {
    const prefix = parsedStatus.status === 'done' ? 'agent signaled done' : 'agent error';
    const suffix = parsedStatus.reason ? `: ${parsedStatus.reason}` : '';
    return { shouldDisable: true, reason: `${prefix}${suffix}` };
  }

  if (expiresAt) {
    const exp = new Date(expiresAt);
    if (!Number.isNaN(exp.getTime()) && exp.getTime() <= now.getTime()) {
      return { shouldDisable: true, reason: `expired at ${expiresAt}` };
    }
  }

  const effectiveMax = resolveMaxRuns(input.maxRuns, input.globalMaxRuns);
  if (effectiveMax !== null && runCount >= effectiveMax) {
    return { shouldDisable: true, reason: `max runs reached (${effectiveMax})` };
  }

  return { shouldDisable: false };
}

/**
 * Resolve a rule's effective maxRuns:
 *  - explicit number → use it;
 *  - null → unlimited (the rule opted out via `maxRuns: null`);
 *  - undefined → fall back to the global default.
 * Returns null for "unlimited".
 */
export function resolveMaxRuns(
  ruleMax: number | null | undefined,
  globalMax?: number,
): number | null {
  if (ruleMax === null) return null; // explicit unlimited
  if (typeof ruleMax === 'number') return ruleMax;
  return globalMax ?? DEFAULT_MAX_RUNS;
}

/** Convenience: which agent statuses disable a rule. */
export const DISABLING_STATUSES: ReadonlySet<RuleStatus> = new Set(['done', 'error']);
