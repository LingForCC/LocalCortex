/**
 * Pure decision logic for the prompt-submit handoff popup.
 *
 * Spec: docs/features/handoffs/README.md → "Prompt-submit prompt".
 *
 * When a `*.prompt-submit` event arrives at the ingress (fired by a ZCode/Codex
 * `UserPromptSubmit` hook each time the user sends a prompt), the app opens a
 * popup that asks one of two questions depending on whether a handoff row
 * already exists for that session:
 *   - none exists → "new" mode: offer to attach handoff context.
 *   - one exists  → "existing" mode: offer to enable/disable it.
 *
 * This module holds the pure, Electron-free decisions (is this a prompt-submit
 * event? new or existing? what sessionId?) so they're unit-testable in plain
 * Vitest, following the same "factor logic out of Electron" rule as
 * handoff-enrichment (docs/tech-stack.md §5).
 */

import { CODEX_PROMPT_SUBMIT_EVENT, ZCODE_PROMPT_SUBMIT_EVENT } from '@shared/constants';
import type { HandoffPromptPayload } from '@shared/schemas/ipc-schema';
import type { Handoff } from '@shared/types';

/**
 * Minimal repo interface this helper needs. Declared locally so tests can pass
 * a one-off fake without constructing a full HandoffsRepository.
 */
export interface PromptSubmitHandoffLookup {
  findBySessionId(sessionId: string): Handoff | null;
}

/** True iff the event type is one of the known prompt-submit event types. */
export function isPromptSubmitEvent(type: string): boolean {
  return type === ZCODE_PROMPT_SUBMIT_EVENT || type === CODEX_PROMPT_SUBMIT_EVENT;
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
