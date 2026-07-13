/**
 * Pure decision logic for the prompt-submit handoff popup.
 *
 * Spec: docs/features/handoffs/README.md → "Prompt-submit prompt".
 *
 * When a `<source>.prompt-submit` event arrives at the ingress (fired by a
 * `UserPromptSubmit` hook each time the user sends a prompt), the app *may* open
 * a popup that asks one of two questions depending on whether a handoff row
 * already exists for that session:
 *   - none exists → "new" mode: offer to attach handoff context.
 *   - one exists  → "existing" mode: offer to enable/disable it.
 *
 * The popup opens **only** when the event's type is the `promptSubmitEventType`
 * of an agent referenced by an enabled handoff profile. An event from an agent
 * with no enabled profile is ignored by the popup (it can still drive rule
 * runs/enrichment independently if a rule matches). The allowed event types are
 * derived from the agents catalog + handoff profiles by
 * `collectPromptSubmitEventTypes` below — there is no hard-coded agent list.
 *
 * This module holds the pure, Electron-free decisions (is this a prompt-submit
 * event we care about? new or existing? what sessionId?) so they're unit-
 * testable in plain Vitest, following the same "factor logic out of Electron"
 * rule as handoff-enrichment (docs/tech-stack.md §5).
 */

import type { HandoffPromptPayload } from '@shared/schemas/ipc-schema';
import type { Handoff } from '@shared/types';

/**
 * Minimal repo interface this helper needs. Declared locally so tests can pass
 * a one-off fake without constructing a full HandoffsRepository.
 */
export interface PromptSubmitHandoffLookup {
  findBySessionId(sessionId: string): Handoff | null;
}

/**
 * Narrow shape of a handoff profile this module needs to derive the allowed
 * prompt-submit event types. Declared locally so tests stay DB-free.
 */
export interface PromptSubmitProfileLike {
  agentId: string;
  enabled: boolean;
}

/**
 * Narrow shape of an agents-catalog row this module needs. Declared locally so
 * tests stay DB-free.
 */
export interface PromptSubmitAgentLike {
  id: string;
  promptSubmitEventType: string;
}

/**
 * Build the set of prompt-submit event types the popup should react to, by
 * joining enabled handoff profiles to their referenced agents.
 *
 * A profile contributes its agent's `promptSubmitEventType` only when the
 * profile is enabled AND its `agentId` resolves to a cataloged agent. Duplicate
 * event types (e.g. two profiles for the same agent) collapse to one entry.
 * Returns a fresh `Set` each call.
 */
export function collectPromptSubmitEventTypes(
  profiles: PromptSubmitProfileLike[],
  agents: PromptSubmitAgentLike[],
): Set<string> {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const types = new Set<string>();
  for (const p of profiles) {
    if (!p.enabled) continue;
    const agent = byId.get(p.agentId);
    if (agent) types.add(agent.promptSubmitEventType);
  }
  return types;
}

/**
 * True iff `type` is a prompt-submit event type the popup should react to —
 * i.e. it is a member of `allowedTypes`, the set of `promptSubmitEventType`
 * values backing enabled handoff profiles (built by
 * `collectPromptSubmitEventTypes`). The caller owns building the set from the
 * catalog + profiles; this helper is a pure membership check.
 */
export function isPromptSubmitEvent(type: string, allowedTypes: Set<string>): boolean {
  return allowedTypes.has(type);
}

/** Read `payload.sessionId` as a string, or undefined if absent/not a string. */
export function readSessionId(payload: Record<string, unknown>): string | undefined {
  const v = payload['sessionId'];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Decide which popup mode applies given the existing handoff row (if any) for a
 * session: null → 'new' (attach form), present → 'existing' (enable/disable).
 */
export function decideHandoffPromptMode(existing: Handoff | null): 'new' | 'existing' {
  return existing ? 'existing' : 'new';
}

/** Best-effort read of an event's `source`, falling back to the event type. */
function readSource(event: PromptSubmitEventLike): string {
  const s = event['source'];
  return typeof s === 'string' && s.length > 0 ? s : (event.type.split('.')[0] ?? '');
}

/** Minimal event shape this helper needs (avoids importing the full type). */
interface PromptSubmitEventLike {
  type: string;
  /** Optional top-level source (the hooks set it; the ingress may strip it). */
  source?: unknown;
  payload: Record<string, unknown>;
}

/**
 * Compose the full prompt-submit decision for one event: read its sessionId,
 * look up any existing handoff (regardless of enabled state), and return the
 * popup payload (mode 'new' or 'existing' + the current handoff row). Returns
 * null if the event has no usable sessionId — nothing to prompt about.
 *
 * Pure and side-effect-free: the caller owns the window/UI side effects.
 */
export function buildPromptSubmitPrompt(
  event: PromptSubmitEventLike,
  repo: PromptSubmitHandoffLookup,
): HandoffPromptPayload | null {
  const sessionId = readSessionId(event.payload);
  if (!sessionId) return null;
  const existing = repo.findBySessionId(sessionId);
  return {
    sessionId,
    mode: decideHandoffPromptMode(existing),
    source: readSource(event),
    handoff: existing,
  };
}
