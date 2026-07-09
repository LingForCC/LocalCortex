# Handoffs — Test Plan

Covers **schema validation**, **repository persistence**, **the enrichment seam** (session-id → context merge), and the **Handoffs UI panel**. The behavior of the fulfilling agent *run* (matching, execution, stop conditions) is covered by [Triggers](../triggers/test-plan.md), [Agent backends](../agent-backends/test-plan.md), and [Stop conditions](../stop-conditions/test-plan.md).

---

## In scope

- Zod schema validation for `HandoffSchema` + `CreateHandoffSchema`.
- Persistence: create / list / get / delete + `findEnabledBySessionId` / `setEnabled` in the `pending_reviews` table.
- The pure enrichment seam: `enrichEventForSession` + `mergeEnrichment` (unknown / enabled / disabled; fire-on-every-match; copy semantics).
- The composition orchestrator `prepareHandoffEnrichment` — the inline Electron wiring in `index.ts`'s `onMatched`, factored out so it's testable. It composes lookup → merge → return (no post-run marking — an enabled handoff fires every match).
- Renderer UI: Handoffs panel registration form + list table with an enable/disable Switch per row.

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
| H-S5 | `enabled` required (omitting rejects) | rejects |
| H-S5b | `enabled=false` parses | parses |
| H-S6 | `enabled` non-boolean → rejects | rejects |
| H-S7 | `reminderTitle` optional — omitted parses | parses |
| H-C1 | `CreateHandoffSchema` valid with context | parses |
| H-C2 | `CreateHandoffSchema` sessionId empty → rejects | rejects |
| H-C3 | `CreateHandoffSchema` context omitted → defaults `{}` | parses with `{}` |
| H-C4 | `CreateHandoffSchema` reminderTitle optional | parses |

### Repository — `HandoffsRepository` (`src/main/db/repositories/handoffs.ts`)
**Status:** ✅ covered — `src/main/db/repositories/handoffs.test.ts` (9 cases).

| # | Case | Expected |
| --- | --- | --- |
| H-R1 | create + get round-trips `context` through JSON | ✅ existing |
| H-R2 | list orders newest-first | ✅ existing |
| H-R3 | findEnabledBySessionId returns only enabled handoffs | ✅ existing |
| H-R4 | findEnabledBySessionId returns the most recent when several exist | ✅ existing |
| H-R5 | setEnabled flips the flag and persists (disabled → no match; re-enable → matches) | ✅ existing |
| H-R6 | setEnabled on a missing id returns false | ✅ existing |
| H-R7 | delete removes the row; second delete returns false | ✅ existing |
| H-R8 | normalizes a non-0/1 enabled integer to false (defensive read) | ✅ existing |
| H-R9 | throws on read when context_json is invalid (schema parse fails) | ✅ existing |

### Enrichment helpers — `enrichEventForSession` / `mergeEnrichment` (`src/main/events/handoff-enrichment.ts`)
**Status:** ✅ covered — `src/main/events/handoff-enrichment.test.ts` (10 cases).

| # | Case | Expected |
| --- | --- | --- |
| H-E1 | sessionId undefined → null | ✅ existing |
| H-E2 | sessionId empty → null | ✅ existing |
| H-E3 | unknown session → null | ✅ existing |
| H-E4 | enabled handoff → returns context + handoffId | ✅ existing |
| H-E5 | disabled handoff → null | ✅ existing |
| H-E6 | fires again after re-enabling (no fulfilled state) | ✅ existing |
| H-E7 | returns a copy (mutation doesn't leak) | ✅ existing |
| H-E8 | merge null → payload unchanged (same ref) | ✅ existing |
| H-E9 | merge adds enrichment keys | ✅ existing |
| H-E10 | enrichment overrides existing payload keys (context wins) | ✅ existing |

---

## Integration — the enrichment composition (`prepareHandoffEnrichment`)

The inline `onMatched` wiring in `index.ts` composes two things: (1) look up the enabled handoff, (2) merge its context into the event payload. That composition is extracted into a pure function `prepareHandoffEnrichment` so it's testable without Electron. There is no post-run marking — an enabled handoff fires every match.

**Status:** ✅ covered — `src/main/events/handoff-enrichment.test.ts` → `prepareHandoffEnrichment` suite (8 cases).

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| H-I1 | no enabled handoff → event passes through unchanged | event with unmatched sessionId; call orchestrator | enriched event === input; `matched=false` |
| H-I2 | enabled handoff → context merged into payload | event with an enabled handoff's sessionId | merged payload contains the handoff's context keys |
| H-I3 | original payload keys preserved (merge, not replace) | event with extra payload keys | merged payload keeps original keys + enrichment |
| H-I4 | enrichment overrides a colliding payload key | event whose payload has a key also in context | context value wins |
| H-I5 | fires on every call (no fulfilled state) — repeated matches all enrich | call orchestrator 3× for the same session | `matched=true` each time |
| H-I6 | disabled handoff → no enrichment | event with a disabled handoff's sessionId | passthrough; `matched=false` |
| H-I6b | event without sessionId → no enrichment | event lacking `payload.sessionId` | `matched=false` |
| H-I6c | non-string sessionId (e.g. number) → treated as no session id | event with `sessionId: 12345` | `matched=false` |

---

## E2E (Playwright) — Handoffs panel

**Status:** planned — `playwright/handoffs.spec.ts` (on the shared isolation fixture).

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| H-E2E1 | Register a handoff via the UI | Handoffs tab → fill session id + a context row → Register | Row appears in the table, enabled toggle on |
| H-E2E2 | Handoff persists across reload | Register; relaunch the app | Row still present |
| H-E2E3 | Toggle enable/disable | Click the Switch on a row | `enabled` flips; persists across reload |
| H-E2E4 | Delete a handoff | Delete button on a row | Row removed |
| H-E2E5 | Validation feedback | Submit with empty session id | Inline error shown; nothing saved |

---

## Manual test plan

Run after any change to the enrichment seam, the hook, or the fulfilling rule.

1. **Hook → enrichment → run (happy path).** Register an enabled handoff for a real ZCode session id with `parentTaskId=<some OmniFocus task>`. Complete the ZCode session (or a round). Confirm: a run appears in Run history (trigger `event`) and the rule's prompt rendered `{{parentTaskId}}`.
2. **Fires each round.** With the handoff still enabled, trigger a second `Stop` for the same session (or re-POST the event). Confirm a second run fires — the handoff stays enabled and enriches every match.
3. **Disable stops firing.** Toggle the handoff off in the panel; re-POST the event. Confirm no run fires for the handoff (the rule may still run if it matches the event type, but no context is injected). Re-enable; confirm it fires again.
4. **No handoff registered.** Complete a session with no enabled handoff. Confirm the rule still runs (if it matches the event type) but no context is injected.
5. **Multiple managers.** With both an OmniFocus-rule and a Todoist-rule matching `zcode.session-complete`, complete a session for a handoff whose `context.taskManager=omnifocus`. Confirm both runs fire (they receive the same context); only you can decide whether that's desired — use `trigger.filter` on `taskManager` to scope a rule to one manager.

---

## Related

- [Handoffs README](./README.md)
- [Triggers test plan](../triggers/test-plan.md) (event matching + template rendering)
- design: [§6.7 ingress](../../architecture.md)
