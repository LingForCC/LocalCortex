/**
 * Pure handoff-enrichment logic — the seam between an incoming session-complete
 * event and a registered handoff.
 *
 * Spec: the agent-done → review-subtask flow. When a session completes, an
 * event carrying `payload.sessionId` arrives at the ingress. This module looks
 * up the enabled handoff for that session and returns its opaque `context` map
 * to be merged into the event payload (so the fulfilling rule can render
 * `{{key}}` template variables).
 *
 * Pure logic — depends only on the HandoffsRepository interface (no `electron`
 * import), so it's unit-testable with a fake repo. Has ZERO domain knowledge
 * of any task manager: `context` is an opaque `Record<string, string>` (Level-2
 * abstraction).
 *
 * **Fire-on-every-match (not fire-once).** An enabled handoff matches EVERY
 * session-complete event for its sessionId — so a multi-round coding session
 * (each round emits a Stop event) creates the reminder each round. There is no
 * fulfilled state and no post-run marking; the handoff stays enabled until the
 * user disables it. Disabled handoffs never match.
 */

/**
 * Minimal repo interface this helper needs. Declared locally so tests can pass
 * a one-off fake without constructing a full HandoffsRepository.
 */
export interface HandoffLookup {
  findEnabledBySessionId(sessionId: string): { id: string; context: Record<string, string> } | null;
}

/** Result of looking up enrichment for a session: the handoff id + its context. */
export interface HandoffEnrichment {
  /** The handoff row id (informational — no post-run marking happens). */
  handoffId: string;
  /** Opaque context merged into the event payload; keys become {{key}} vars. */
  context: Record<string, string>;
}

/**
 * Look up the enrichment for a session, or null if there is no enabled handoff
 * for it. Returns the handoff id (informational) and the context map (merged
 * into the event payload).
 *
 * An enabled handoff matches EVERY time this is called for its sessionId —
 * there is no fulfilled state to flip afterwards.
 */
export function enrichEventForSession(
  sessionId: string | undefined,
  repo: HandoffLookup,
): HandoffEnrichment | null {
  if (!sessionId) return null;
  const handoff = repo.findEnabledBySessionId(sessionId);
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
 * event to enqueue, and whether a handoff matched. When there's no enabled
 * handoff, the event is returned unchanged.
 *
 * This factors the inline `onMatched` wiring out of `src/main/index.ts` so the
 * composition (lookup → merge) is unit-testable without Electron. Unlike the
 * old model, there is no post-run callback — an enabled handoff fires every
 * match and stays enabled.
 */
export interface PreparedEnrichment<E extends EventLike> {
  /** The event to enqueue (enriched, or the original if no handoff matched). */
  event: E;
  /** True iff an enabled handoff matched and context was merged into the event. */
  matched: boolean;
}

/**
 * Compose the full enrichment path for one event: look up the enabled handoff
 * by `payload.sessionId` and merge its context into the payload.
 *
 * Pure and side-effect-free: the caller enqueues the returned event, and that's
 * it — no post-run marking. An enabled handoff will match again on the next
 * session-complete event for the same session.
 */
export function prepareHandoffEnrichment<E extends EventLike>(
  event: E,
  repo: HandoffLookup,
): PreparedEnrichment<E> {
  const sessionId = readSessionId(event.payload);
  const enrichment = enrichEventForSession(sessionId, repo);

  if (!enrichment) {
    return { event, matched: false };
  }

  return {
    event: { ...event, payload: mergeEnrichment(event.payload, enrichment.context) },
    matched: true,
  };
}
