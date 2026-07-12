# Handoffs — Test Plan

Covers **schema validation**, **repository persistence**, **the enrichment seam** (session-id → context merge), and the **Handoffs UI panel**. The behavior of the fulfilling agent *run* (matching, execution, stop conditions) is covered by [Triggers](../triggers/test-plan.md), [Agent backends](../agent-backends/test-plan.md), and [Stop conditions](../stop-conditions/test-plan.md).

---

## In scope

- Zod schema validation for `HandoffSchema` + `CreateHandoffSchema`.
- Persistence: create / list / get / delete + `findEnabledBySessionId` / `findBySessionId` / `setEnabled` in the `pending_reviews` table.
- The pure enrichment seam: `enrichEventForSession` + `mergeEnrichment` (unknown / enabled / disabled; fire-on-every-match; copy semantics).
- The composition orchestrator `prepareHandoffEnrichment` — the inline Electron wiring in `index.ts`'s `onMatched`, factored out so it's testable. It composes lookup → merge → return (no post-run marking — an enabled handoff fires every match).
- **Prompt-submit popup decision logic** (`prompt-submit.ts`): new-vs-existing mode selection, sessionId reading, prompt payload construction.
- **Ingress `onEvent` observer** (`ingress.ts`): fires for every accepted event independent of rule matches; isolated from the match/enqueue path. Includes the regression guard that a prompt-submit event matching a rule runs BOTH the popup observer and the rule.
- **IPC handlers** (`ipc/handoffs.ts`): CRUD channels + the `onChanged` broadcast that refreshes the main panel when a handoff changes from the popup window.
- Renderer UI: Handoffs panel registration form + list table with an enable/disable Switch per row; prompt-submit popup (`HandoffPrompt.tsx`).

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
| E2E (Electron) | Playwright | `playwright/*.spec.ts` |
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
**Status:** ✅ covered — `src/main/db/repositories/handoffs.test.ts` (11 cases).

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
| H-R10 | findBySessionId matches enabled AND disabled rows (unlike findEnabled) | ✅ new |
| H-R11 | findBySessionId returns the most recent when several exist (even if newest disabled) | ✅ new |

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

**Status:** ✅ covered — `src/main/events/handoff-enrichment.test.ts` → `prepareHandoffEnrichment` suite (9 cases).

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
| H-I7 | enriches a prompt-submit event when an enabled handoff exists (resume) | `zcode.prompt-submit` event for a session with an enabled handoff | `matched=true`, context keys present — enrichment is event-type-agnostic | ✅ new |

---

## Prompt-submit popup decision logic — `prompt-submit.ts`

Pure, Electron-free decision helpers for the prompt-submit popup (which mode to
show, building the prompt payload). Factored out of `index.ts` so they're
unit-testable. `buildPromptSubmitPrompt` uses `findBySessionId` (enabled OR
disabled), distinct from the completion-time `findEnabledBySessionId`.

**Status:** ✅ covered — `src/main/events/prompt-submit.test.ts` (12 cases).

| # | Case | Expected |
| --- | --- | --- |
| H-SS1 | isPromptSubmitEvent true for `zcode.prompt-submit` + `codex.prompt-submit` | ✅ new |
| H-SS2 | isPromptSubmitEvent false for completion + arbitrary types | ✅ new |
| H-SS3 | readSessionId reads a string | ✅ new |
| H-SS4 | readSessionId undefined for missing/non-string | ✅ new |
| H-SS5 | decideHandoffPromptMode null → 'new' | ✅ new |
| H-SS6 | decideHandoffPromptMode present → 'existing' (enabled OR disabled) | ✅ new |
| H-SS7 | buildPromptSubmitPrompt null when no sessionId | ✅ new |
| H-SS8 | buildPromptSubmitPrompt null when sessionId non-string | ✅ new |
| H-SS9 | buildPromptSubmitPrompt new mode (no handoff) | ✅ new |
| H-SS10 | buildPromptSubmitPrompt existing mode (disabled handoff) | ✅ new |
| H-SS10b | buildPromptSubmitPrompt existing mode (ENABLED handoff — resume+enrichment case) | ✅ new |
| H-SS11 | source derived from event type when top-level source absent | ✅ new |
| H-SS12 | explicit top-level source used when provided | ✅ new |

---

## Ingress `onEvent` observer — `ingress.ts`

The `onEvent` observer fires for **every** accepted event, before rule matching
and independent of whether any rule matched. It powers the prompt-submit popup.
Isolated in a try/catch inside the ingress so an observer failure never blocks
the match/enqueue path or the HTTP reply.

**Status:** ✅ covered — `src/main/events/ingress.test.ts` (5 cases).

| # | Case | Expected |
| --- | --- | --- |
| H-IG1 | onEvent fires for every accepted event, even with zero rule matches | ✅ new |
| H-IG2 | onEvent fires before onMatched; does not require a match | ✅ new |
| H-IG3 | a throwing onEvent observer does not break the match/enqueue path or the reply | ✅ new |
| H-IG4 | onEvent not fired when the event is malformed (400 short-circuits) | ✅ new |
| H-IG5 | **regression guard:** a prompt-submit event matching a rule fires onEvent AND onMatched (popup + rule run, not popup-only) | ✅ new |

> H-IG5 is the critical regression guard for the corrected behavior: prompt-
> submit events are **not** popup-only — a matching rule runs, and enrichment
> applies. It locks in that no prompt-submit carve-out silently creeps into the
> matcher or `onMatched`.

---

## IPC handlers — `ipc/handoffs.ts`

The `handoffs:*` handlers validate payloads (Zod) then call the repo. The
`onChanged` broadcast (added for the popup) fires after create/delete/setEnabled
so the main Handoffs panel refreshes when a handoff changes from the popup
window. Mocks `electron`'s `ipcMain` via `vi.mock` to capture handlers.

**Status:** ✅ covered — `src/main/ipc/handoffs.test.ts` (7 cases).

| # | Case | Expected |
| --- | --- | --- |
| H-IPC1 | registers all five handoff channels | ✅ new |
| H-IPC2 | HANDOFF_CREATE inserts and returns the canonical row | ✅ new |
| H-IPC3 | HANDOFF_SET_ENABLED flips the flag and returns true | ✅ new |
| H-IPC4 | HANDOFF_DELETE removes a row and returns true | ✅ new |
| H-IPC5 | onChanged fires after create, delete, AND setEnabled | ✅ new |
| H-IPC6 | onChanged does NOT fire when delete/setEnabled affect zero rows | ✅ new |
| H-IPC7 | omitting onChanged is fine (no broadcast, no throw) | ✅ new |

---

## E2E (Playwright) — Handoffs panel + prompt-submit popup

**Status:** ✅ covered — `playwright/handoffs.spec.ts` (H-E2E1–H-E2E5) + `playwright/handoff-prompt.spec.ts` (H-E2E6–H-E2E9) on the shared isolation fixture.

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| H-E2E1 | Register a handoff via the UI | Handoffs tab → fill session id + a context row → Register | Row appears in the table, enabled toggle on |
| H-E2E2 | Handoff persists across reload | Register; relaunch the app | Row still present |
| H-E2E3 | Toggle enable/disable | Click the Switch on a row | `enabled` flips; persists across reload |
| H-E2E4 | Delete a handoff | Delete button on a row | Row removed |
| H-E2E5 | Validation feedback | Submit with empty session id | Inline error shown; nothing saved |
| H-E2E6 | Prompt-submit popup (new session) | POST a `zcode.prompt-submit` event for an unknown sessionId | Popup window opens with the attach form, sessionId pre-filled |
| H-E2E7 | Prompt-submit popup (existing session) | Attach a handoff, then re-POST `zcode.prompt-submit` for the same sessionId | Popup opens with the enable/disable toggle (mode 'existing') |
| H-E2E8 | Popup → main panel sync | Attach a handoff from the popup; the main window's Handoffs panel should show it without manual reload | Row appears in main panel (driven by `handoffs:changed` broadcast) |
| H-E2E9 | One popup per session | With the popup open for a session, POST a second `prompt-submit` for the same sessionId | Existing popup re-focuses; no second window opens |

---

## Manual test plan

Run after any change to the enrichment seam, the hook, the prompt-submit popup,
or the fulfilling rule.

1. **Hook → enrichment → run (happy path).** Register an enabled handoff for a real ZCode session id with `parentTaskId=<some OmniFocus task>`. Complete the ZCode session (or a round). Confirm: a run appears in Run history (trigger `event`) and the rule's prompt rendered `{{parentTaskId}}`.
2. **Fires each round.** With the handoff still enabled, trigger a second `Stop` for the same session (or re-POST the event). Confirm a second run fires — the handoff stays enabled and enriches every match.
3. **Disable stops firing.** Toggle the handoff off in the panel; re-POST the event. Confirm no run fires for the handoff (the rule may still run if it matches the event type, but no context is injected). Re-enable; confirm it fires again.
4. **No handoff registered.** Complete a session with no enabled handoff. Confirm the rule still runs (if it matches the event type) but no context is injected.
5. **Multiple managers.** With both an OmniFocus-rule and a Todoist-rule matching `zcode.session-complete`, complete a session for a handoff whose `context.taskManager=omnifocus`. Confirm both runs fire (they receive the same context); only you can decide whether that's desired — use `trigger.filter` on `taskManager` to scope a rule to one manager.
6. **Prompt-submit popup — new session.** Start a new ZCode/Codex session (or POST a `*.prompt-submit` event with a fresh sessionId). Confirm the popup opens with the attach form; fill context and attach. Confirm the handoff appears in the main Handoffs panel.
7. **Prompt-submit popup — resume.** With a handoff attached for a session, start that session again (or re-POST the `*.prompt-submit` event). Confirm the popup opens in existing-session mode with the enable/disable toggle reflecting current state.
8. **Prompt-submit + rule (both paths).** Author a rule on `eventType: zcode.prompt-submit` (e.g. a logging rule). Attach an enabled handoff for a session, then re-POST `zcode.prompt-submit` for it. Confirm: the popup opens (existing mode) **and** the rule runs **and** its run sees the enriched `{{parentTaskId}}` (resume case). Then POST `zcode.prompt-submit` for a brand-new session (no handoff): the popup opens (new mode) and the rule runs, but without context (nothing pre-existed to enrich).

---

## Related

- [Handoffs README](./README.md)
- [Triggers test plan](../triggers/test-plan.md) (event matching + template rendering)
- design: [§6.7 ingress](../../architecture.md)
