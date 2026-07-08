/**
 * Pure handoff-enrichment logic — the seam between an incoming session-complete
 * event and a registered handoff.
 *
 * Spec: the agent-done → review-subtask flow. When a session completes, an
 * event carrying `payload.sessionId` arrives at the ingress. This module looks
 * up the pending handoff for that session and returns its opaque `context` map
 * to be merged into the event payload (so the fulfilling rule can render
 * `{{key}}` template variables).
 *
 * Pure logic — depends only on the HandoffsRepository interface (no `electron`
 * import), so it's unit-testable with a fake repo. Has ZERO domain knowledge
 * of any task manager: `context` is an opaque `Record<string,string>` (Level-2
 * abstraction).
 *
 * Idempotency: only `pending` handoffs match (`findPendingBySessionId` filters
 * on status), so repeated Stop events for the same session enrich at most once
 * until the handoff is fulfilled/cancelled.
 */

/**
 * Minimal repo interface this helper needs. Declared locally so tests can pass
 * a one-off fake without constructing a full HandoffsRepository.
 */
export interface HandoffLookup {
  findPendingBySessionId(sessionId: string): { id: string; context: Record<string, string> } | null;
}

/** Result of looking up enrichment for a session: the handoff id + its context. */
export interface HandoffEnrichment {
  /** The handoff row id (used to mark it fulfilled after the run completes). */
  handoffId: string;
  /** Opaque context merged into the event payload; keys become {{key}} vars. */
  context: Record<string, string>;
}

/**
 * Look up the enrichment for a session, or null if there is no pending handoff
 * for it. Returns both the handoff id (so the caller can mark it fulfilled
 * after the run) and the context map (merged into the event payload).
 */
export function enrichEventForSession(
  sessionId: string | undefined,
  repo: HandoffLookup,
): HandoffEnrichment | null {
  if (!sessionId) return null;
  const handoff = repo.findPendingBySessionId(sessionId);
  if (!handoff) return null;
  return { handoffId: handoff.id, context: { ...handoff.context } };
}

/**
 * Merge enrichment context into an event payload, returning a new payload
 * object. Existing payload keys are preserved unless the enrichment overrides
 * them (enrichment takes precedence so the handoff's registered context wins).
 */
export function mergeEnrichment(
  payload: Record<string, unknown>,
  enrichment: Record<string, string> | null,
): Record<string, unknown> {
  if (!enrichment) return payload;
  return { ...payload, ...enrichment };
}

/** A read of `payload.sessionId` as a string, or undefined. */
function readSessionId(payload: Record<string, unknown>): string | undefined {
  const v = payload['sessionId'];
  return typeof v === 'string' ? v : undefined;
}

/** Minimal event shape the orchestrator needs (avoids importing the full type). */
interface EventLike {
  payload: Record<string, unknown>;
}

/**
 * The result of preparing enrichment for an event: the (possibly enriched)
 * event to enqueue, plus a callback to run after the fulfilling run completes
 * (marks the handoff fulfilled). When there's no pending handoff, the event is
 * returned unchanged and `onFulfilled` is a no-op.
 *
 * This factors the inline `onMatched` wiring out of `src/main/index.ts` so the
 * composition (lookup → merge → mark-fulfilled) is unit-testable without
 * Electron. `markFulfilled` is injected so the orchestrator stays pure and
 * side-effect-free until the caller invokes `onFulfilled`.
 */
export interface PreparedEnrichment<E extends EventLike> {
  /** The event to enqueue (enriched, or the original if no handoff matched). */
  event: E;
  /** True iff a pending handoff matched and context was merged into the event. */
  matched: boolean;
  /** Call after the run completes to mark the handoff fulfilled. No-op if none. */
  onFulfilled: (runId: number, ruleId?: string) => void;
}

/**
 * Compose the full enrichment path for one event: look up the pending handoff
 * by `payload.sessionId`, merge its context into the payload, and return a
 * callback that marks it fulfilled after a run.
 *
 * Pure: the mark-fulfilled side effect is deferred to the returned callback and
 * performed via the injected `markFulfilled` (so tests pass a spy and the real
 * caller passes `handoffsRepo.markFulfilled`).
 */
export function prepareHandoffEnrichment<E extends EventLike>(
  event: E,
  repo: HandoffLookup,
  markFulfilled: (handoffId: string, runId: number, ruleId?: string) => boolean,
): PreparedEnrichment<E> {
  const sessionId = readSessionId(event.payload);
  const enrichment = enrichEventForSession(sessionId, repo);

  if (!enrichment) {
    return {
      event,
      matched: false,
      onFulfilled: () => {
        /* no handoff matched — nothing to fulfill */
      },
    };
  }

  const enrichedEvent = { ...event, payload: mergeEnrichment(event.payload, enrichment.context) };
  const handoffId = enrichment.handoffId;
  return {
    event: enrichedEvent,
    matched: true,
    onFulfilled: (runId, ruleId) => {
      markFulfilled(handoffId, runId, ruleId);
    },
  };
}
