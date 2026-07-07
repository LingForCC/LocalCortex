# Rules — Test Plan

Covers rule **authoring, persistence, and CRUD**. The behavior of *running* a rule (scheduling, triggering, agent execution, stopping) is covered by the [Triggers](../triggers/test-plan.md), [Agent backends](../agent-backends/test-plan.md), and [Stop conditions](../stop-conditions/test-plan.md) test plans.

---

## In scope

- Zod schema validation (all of [rule-config-schema §11](../../rule-config-schema.md#11-validation-rules)).
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

---

## Integration / E2E (Playwright)

**Status:** not yet implemented (E2E harness exists at `playwright/e2e.spec.ts` but only covers app launch). Planned cases:

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| R-E1 | Create a rule via the UI | Rules tab → New rule → fill form → Create | Row appears in table; reload persists |
| R-E2 | Edit a rule | Edit a row → change name → Save | Row updates |
| R-E3 | Toggle enabled | Click the switch on a row | `enabled` flips; persists across reload |
| R-E4 | Delete a rule | Delete → confirm | Row removed |
| R-E5 | Validation feedback | Submit with empty rule text | Inline error shown; nothing saved |
| R-E6 | Run-now enqueues | Click Run on a rule | A `runs` row appears (status may be `error` without credentials — that's fine; the enqueue is what's tested) |

---

## Manual test plan

Run after any change to the rule editor or repository.

1. **Create** a minimal tick rule (`gitlab` MCP server, backend `claude`). Confirm it appears in the table and survives app restart (check `~/Library/Application Support/LocalCortex/localcortex.db`).
2. **Edit** the name and interval; confirm the change reflects and the scheduler picks up the new interval.
3. **Disable** then **re-enable**; confirm the run counter resets to 0 and the disable reason clears.
4. **Delete**; confirm the row and its run history are gone.
5. **Validation**: try to save a rule with an empty MCP servers field — confirm rejection at the form, not the DB.
6. **Cross-file**: save a rule referencing `mcpServers: ["ghost"]` (undefined) — confirm it saves but the Sources tab flags it and a run fails with a clear "server 'ghost' is not defined" message.

---

## Related
- [Rules README](./README.md)
- [design: rule-config-schema §11 validation](../../rule-config-schema.md#11-validation-rules)
