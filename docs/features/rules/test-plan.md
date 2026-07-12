# Rules — Test Plan

Covers rule **authoring, persistence, and CRUD**. The behavior of *running* a rule (scheduling, triggering, agent execution, stopping) is covered by the [Triggers](../triggers/test-plan.md), [Agent backends](../agent-backends/test-plan.md), and [Stop conditions](../stop-conditions/test-plan.md) test plans.

---

## In scope

- Zod schema validation (all of [Rules README → validation rules](./README.md#validation-rules-enforced-on-save)).
- Persistence: create / read / update / delete / set-enabled in the `rules` table.
- IPC handlers (`rules:list/get/create/update/delete/setEnabled`).
- Renderer UI: RuleEditor form + RuleList table interactions.

## Out of scope (covered elsewhere)
- Trigger matching & cadence → [Triggers](../triggers/test-plan.md).
- Agent execution & MCP wiring → [Agent backends](../agent-backends/test-plan.md).
- Stop-condition evaluation → [Stop conditions](../stop-conditions/test-plan.md).
- mcpServers cross-file validation → [MCP sources](../mcp-sources/test-plan.md).

---

## Test types

| Type | Tool | Where |
| --- | --- | --- |
| Unit (pure logic) | Vitest | `src/**/*.test.ts` |
| E2E (Electron) | Playwright | `playwright/*.spec.ts` |
| Manual | operator | — |

---

## Unit tests

### Schema validation — `RuleSchema` (`src/shared/schemas/rule-schema.ts`)
**Status:** covered indirectly via repository tests (parsing rows) — add a dedicated suite.

| # | Case | Expected |
| --- | --- | --- |
| R-U1 | Valid tick rule with all fields | parses |
| R-U2 | Valid event rule with filter | parses |
| R-U3 | `rule` empty | rejects |
| R-U4 | `mcpServers` empty array | rejects |
| R-U5 | tick `intervalSeconds < 300` | rejects (floor) |
| R-U6 | tick `intervalSeconds` omitted | parses (falls back to global at runtime) |
| R-U7 | event `eventType` empty | rejects |
| R-U8 | `maxRuns: 0` | rejects (must be positive) |
| R-U9 | `maxRuns: null` | parses (unlimited) |
| R-U10 | `maxRuns: -5` | rejects |
| R-U11 | `expiresAt` not ISO | rejects |
| R-U12 | `backend` not claude/codex | rejects |
| R-U13 | `sandbox` not read-only/workspace-write | rejects |
| R-U14 | defaults applied: `enabled=true`, `sandbox=read-only`, `args/env` | parses with defaults |
| R-U15 | **`model` omitted** → parses (optional; falls back to app default at runtime) | parses, `model` undefined ✅ new |
| R-U16 | **`model` set to a free-text id (e.g. `gpt-5.6-sol`)** | parses ✅ new |
| R-U17 | **`modelReasoningEffort` valid enum (`minimal`..`xhigh`)** | parses ✅ new |
| R-U18 | **`modelReasoningEffort` invalid (e.g. `ultra`)** | rejects (not in enum) ✅ new |

**Existing coverage:** `RuleSchema.parse` is exercised through `rowToRule` in `src/main/db/db.test.ts` (RulesRepository suite, 7 tests). The dedicated cases above are not yet a standalone suite.

### Repository — `RulesRepository` (`src/main/db/repositories/rules.ts`)
**Status:** ✅ covered — `src/main/db/db.test.ts` → `RulesRepository` suite.

| # | Case | Expected |
| --- | --- | --- |
| R-R1 | create + get round-trips JSON fields (trigger, mcpServers) | ✅ existing |
| R-R2 | list orders by name | ✅ existing |
| R-R3 | update persists changed fields | ✅ existing |
| R-U3 → R-R4 | set-enabled records reason; re-enable clears it | ✅ existing |
| R-R5 | incrementRunCount returns new count; resetRunCount zeroes it | ✅ existing |
| R-R6 | delete removes the row | ✅ existing |
| R-R7 | create rejects an invalid rule via schema | ✅ existing |
| R-R8 | **per-rule `model` + `modelReasoningEffort` round-trip through create → get** | values preserved ✅ new |
| R-R9 | **omitted model/effort persist as `undefined` (NULL → inherit app default at run)** | both `undefined` ✅ new |
| R-R10 | **create rejects an invalid `modelReasoningEffort` (e.g. `ultra`) via schema** | throws ✅ new |
| R-R11 | **update persists `model` + `modelReasoningEffort` changes** | updated values retrieved ✅ new |

---

## Integration / E2E (Playwright)

**Status:** ✅ covered — `playwright/rules.spec.ts` (6 cases), on the shared isolation fixture `playwright/fixtures/app.ts` (isolated `--user-data-dir` + `HOME` so tests never touch the operator's real DB or MCP config).

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| R-E1 | Create a rule via the UI | Rules tab → New rule → fill form → Create | Row appears in table; reload persists ✅ existing |
| R-E2 | Edit a rule | Edit a row → change name → Save | Row updates ✅ existing |
| R-E3 | Toggle enabled | Click the switch on a row | `enabled` flips; persists across reload ✅ existing |
| R-E4 | Delete a rule | Delete → confirm | Row removed ✅ existing |
| R-E5 | Validation feedback | Submit with empty rule text | Inline error shown; nothing saved ✅ existing |
| R-E6 | Run-now enqueues | Click Run on a rule | A `runs` row appears (status may be `error` without credentials — that's fine; the enqueue is what's tested) ✅ existing |

---

## Manual test plan

Run after any change to the rule editor or repository.

1. **Create** a minimal tick rule (`gitlab` MCP server, backend `claude`). Confirm it appears in the table and survives app restart (check `~/Library/Application Support/LocalCortex/localcortex.db`).
2. **Edit** the name and interval; confirm the change reflects and the scheduler picks up the new interval.
3. **Disable** then **re-enable**; confirm the run counter resets to 0 and the disable reason clears.
4. **Delete**; confirm the row and its run history are gone.
5. **Validation**: try to save a rule with an empty MCP servers field — confirm rejection at the form, not the DB.
6. **Cross-file**: save a rule referencing `mcpServers: ["ghost"]` (undefined) — confirm it saves but the Sources tab flags it and a run fails with a clear "server 'ghost' is not defined" message.
7. **Per-rule model/effort override (Codex).** Create a Codex rule, set per-rule model `gpt-5.6-sol` and effort `xhigh`. Confirm: both fields save and survive restart; the model/effort inputs only appear when backend is `codex`; leaving both blank saves them as unset (inherits the app default — see [Agent backends A-M9/A-M10](../agent-backends/test-plan.md)).

---

## Related
- [Rules README](./README.md)
- [Rules README → validation rules](./README.md#validation-rules-enforced-on-save)
