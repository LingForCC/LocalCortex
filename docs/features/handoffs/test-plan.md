# Handoffs — Test Plan

Covers **schema validation**, **repository persistence**, **the enrichment seam** (session-id → context merge), and the **Handoffs UI panel**. The behavior of the fulfilling agent *run* (matching, execution, stop conditions) is covered by [Triggers](../triggers/test-plan.md), [Agent backends](../agent-backends/test-plan.md), and [Stop conditions](../stop-conditions/test-plan.md).

---

## In scope

- Zod schema validation for `HandoffSchema` + `CreateHandoffSchema`.
- Persistence: create / list / get / delete + status lifecycle (`findPendingBySessionId`, `markFulfilled`, `cancel`) in the `pending_reviews` table.
- The pure enrichment seam: `enrichEventForSession` + `mergeEnrichment` (unknown / pending / fulfilled / cancelled; idempotency; copy semantics).
- The composition orchestrator `prepareHandoffEnrichment` — the inline Electron wiring in `index.ts`'s `onMatched`, factored out so it's testable. It composes lookup → merge → return, and (via `onFulfilled`) the post-run mark-fulfilled call.
- Renderer UI: Handoffs panel registration form + list table.

## Out of scope (covered elsewhere)

- Event-type matching (does `zcode.session-complete` match the rule?) → [Triggers](../triggers/test-plan.md).
- Agent execution of the fulfilling rule → [Agent backends](../agent-backends/test-plan.md).
- Prompt template rendering of `{{parentTaskId}}` → [Triggers](../triggers/test-plan.md) (`renderTemplate`).

---

## Test types

| Type | Tool | Where |
| --- | --- | --- |
| Unit (pure logic) | Vitest | `src/**/*.test.ts` |
| Integration (composition) | Vitest (fake repo) | `src/**/*.test.ts` |
| E2E (Electron) | Playwright | `playwright/*.spec.ts` (planned) |
| Manual | operator | — |

---

## Unit tests

### Schema validation — `HandoffSchema` / `CreateHandoffSchema` (`src/shared/schemas/handoff-schema.ts`)
**Status:** ✅ covered — `src/shared/schemas/handoff-schema.test.ts`.

| # | Case | Expected |
| --- | --- | --- |
| H-S1 | Valid handoff with all fields | parses |
| H-S2 | `context` omitted → defaults to `{}` | parses with `{}` |
| H-S3 | `id` empty → rejects | rejects |
| H-S4 | `sessionId` empty → rejects | rejects |
| H-S5 | `status` not one of the enum → rejects | rejects |
| H-S6 | `fulfilledRunId` non-positive → rejects | rejects |
| H-S7 | `reminderTitle` optional — omitted parses | parses |
| H-C1 | `CreateHandoffSchema` valid with context | parses |
| H-C2 | `CreateHandoffSchema` sessionId empty → rejects | rejects |
| H-C3 | `CreateHandoffSchema` context omitted → defaults `{}` | parses with `{}` |
| H-C4 | `CreateHandoffSchema` reminderTitle optional | parses |

### Repository — `HandoffsRepository` (`src/main/db/repositories/handoffs.ts`)
**Status:** ✅ covered — `src/main/db/repositories/handoffs.test.ts` (10 cases).

| # | Case | Expected |
| --- | --- | --- |
| H-R1 | create + get round-trips `context` through JSON | ✅ existing |
| H-R2 | list orders newest-first | ✅ existing |
| H-R3 | findPendingBySessionId returns only `pending` | ✅ existing |
| H-R4 | findPendingBySessionId returns the most recent when several exist | ✅ existing |
| H-R5 | markFulfilled sets status, run id, rule id | ✅ existing |
| H-R6 | markFulfilled is idempotent-safe (no longer matches findPending) | ✅ existing |
| H-R7 | markFulfilled without ruleId preserves an existing ruleId (COALESCE) | ✅ existing |
| H-R8 | cancel sets status to `cancelled` | ✅ existing |
| H-R9 | delete removes the row; second delete returns false | ✅ existing |
| H-R10 | validates row shape on read (bad status throws via parse) | ✅ existing |

### Enrichment helpers — `enrichEventForSession` / `mergeEnrichment` (`src/main/events/handoff-enrichment.ts`)
**Status:** ✅ covered — `src/main/events/handoff-enrichment.test.ts` (11 cases).

| # | Case | Expected |
| --- | --- | --- |
| H-E1 | sessionId undefined → null | ✅ existing |
| H-E2 | sessionId empty → null | ✅ existing |
| H-E3 | unknown session → null | ✅ existing |
| H-E4 | pending handoff → returns context + handoffId | ✅ existing |
| H-E5 | fulfilled handoff → null (idempotent) | ✅ existing |
| H-E6 | cancelled handoff → null | ✅ existing |
| H-E7 | does not re-fire after mark-fulfilled | ✅ existing |
| H-E8 | returns a copy (mutation doesn't leak) | ✅ existing |
| H-E9 | merge null → payload unchanged (same ref) | ✅ existing |
| H-E10 | merge adds enrichment keys | ✅ existing |
| H-E11 | enrichment overrides existing payload keys (context wins) | ✅ existing |

---

## Integration — the enrichment composition (`prepareHandoffEnrichment`)

The inline `onMatched` wiring in `index.ts` composes three things: (1) look up the handoff, (2) merge its context into the event payload, (3) after the run completes, mark the handoff fulfilled. That composition is extracted into a pure function `prepareHandoffEnrichment` so it's testable without Electron.

**Status:** ✅ covered — `src/main/events/handoff-enrichment.test.ts` → `prepareHandoffEnrichment` suite.

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| H-I1 | no pending handoff → event passes through unchanged, no fulfillment | event with unmatched sessionId; call orchestrator | enriched event === input; `onFulfilled` not called |
| H-I2 | pending handoff → context merged into payload | event with a pending handoff's sessionId | merged payload contains the handoff's context keys |
| H-I3 | original payload keys preserved (merge, not replace) | event with extra payload keys | merged payload keeps original keys + enrichment |
| H-I4 | enrichment overrides a colliding payload key | event whose payload has a key also in context | context value wins |
| H-I5 | `onFulfilled` callback receives the handoffId | after a (simulated) run completes | called with `{ handoffId }` |
| H-I6 | event without sessionId → no enrichment, no fulfillment | event lacking `payload.sessionId` | passthrough; `onFulfilled` not called |

---

## E2E (Playwright) — Handoffs panel

**Status:** planned — `playwright/handoffs.spec.ts` (on the shared isolation fixture).

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| H-E2E1 | Register a handoff via the UI | Handoffs tab → fill session id + a context row → Register | Row appears in the table with status `pending` |
| H-E2E2 | Handoff persists across reload | Register; relaunch the app | Row still present |
| H-E2E3 | Delete a handoff | Delete button on a row | Row removed |
| H-E2E4 | Validation feedback | Submit with empty session id | Inline error shown; nothing saved |

---

## Manual test plan

Run after any change to the enrichment seam, the hook, or the fulfilling rule.

1. **Hook → enrichment → run (happy path).** Register a pending handoff for a real ZCode session id with `parentTaskId=<some OmniFocus task>`. Complete the ZCode session. Confirm: a run appears in Run history (trigger `event`), the rule's prompt rendered `{{parentTaskId}}`, and the handoff is now `fulfilled` with that run id.
2. **Idempotency.** Trigger a second `Stop` for the same session (or re-POST the event). Confirm no second run fires for the handoff (it's already `fulfilled`).
3. **No handoff registered.** Complete a session with no pending handoff. Confirm the rule still runs (if it matches the event type) but no context is injected and nothing is marked fulfilled.
4. **Cancelled handoff doesn't fire.** Register then cancel a handoff; complete the session. Confirm no enrichment and no fulfillment.
5. **Multiple managers.** With both an OmniFocus-rule and a Todoist-rule matching `zcode.session-complete`, complete a session for a handoff whose `context.taskManager=omnifocus`. Confirm both runs fire (they receive the same context); only you can decide whether that's desired — use `trigger.filter` on `taskManager` to scope a rule to one manager.

---

## Related

- [Handoffs README](./README.md)
- [Triggers test plan](../triggers/test-plan.md) (event matching + template rendering)
- design: [§6.7 ingress](../../architecture.md)
