# Combos & handoff setup — Test Plan

Covers the **combos** (agent + task-manager + backend) feature: the **combos
table + repository**, the **setup builder** (pure rule-building logic), the
**combos IPC** (CRUD + combo↔rule orchestration), the **migration** from the
legacy singleton setup, and the **Combos/Home renderer UI**. The behavior of
*running* a combo's auto-created rule (matching, execution, stop conditions) is
covered by [Triggers](../triggers/test-plan.md), [Agent
backends](../agent-backends/test-plan.md), and [Stop
conditions](../stop-conditions/test-plan.md). The MCP servers table, Sources
CRUD UI, and legacy file import are covered by [MCP sources](../mcp-sources/test-plan.md).

---

## In scope

- **Setup builder** (`setup-builder.ts`): `buildHandoffRule` (per-combo rule
  creation) and `applyComboFieldsToRule` (update that preserves user edits).
- **Combos repository** (`combos.ts`): CRUD + enable/disable + FK behavior.
- **Combos migration** (`006_handoff_combos.sql`): table creation + legacy
  singleton migration (incl. the missing-rule guard).
- **Combos IPC** (`ipc/combos.ts`): create/update/delete/setEnabled with the
  combo↔rule invariants (rule sync, prompt/model preservation, rule cleanup on
  delete).
- **Agents + task-managers catalog** repos + IPC (unchanged from before; still
  used by the combo editor's pickers).
- Renderer UI: the Combos tab (list + inline editor), Home summary, Settings
  (handoff card removed).

## Out of scope (covered elsewhere)

- Event-type matching (does `zcode.session-complete` match the rule?) → [Triggers](../triggers/test-plan.md).
- Agent execution of a combo's rule → [Agent backends](../agent-backends/test-plan.md).
- MCP server table (seeding, CRUD, `getAsConfig`, legacy import, placeholder detection) → [MCP sources](../mcp-sources/test-plan.md).
- Template rendering of `{{parentTaskId}}` → [Triggers](../triggers/test-plan.md) (`renderTemplate`).
- The handoff popup and enrichment pipeline → [Handoffs](../handoffs/test-plan.md).

---

## Test types

| Type | Tool | Where |
| --- | --- | --- |
| Unit (pure logic) | Vitest | `src/**/*.test.ts` |
| Integration (IPC with fake repos) | Vitest (`vi.mock('electron')`) | `src/**/*.test.ts` |
| Migration (raw SQL on in-memory DB) | Vitest / node script | inline |
| E2E (Electron) | Playwright | `playwright/*.spec.ts` (planned) |
| Manual | operator | — |

---

## Unit tests

### Setup builder — `buildHandoffRule` + `applyComboFieldsToRule` (`src/main/handoff-setup/setup-builder.ts`)
**Status:** ✅ covered — `src/main/handoff-setup/setup-builder.test.ts` (17 cases).

`buildHandoffRule` (rule creation):

| # | Case | Expected |
| --- | --- | --- |
| HS-S1 | builds a rule with the correct event trigger from the agent | `trigger = { type: 'event', eventType: 'zcode.session-complete' }` ✅ |
| HS-S2 | uses the caller-supplied per-combo id (not a fixed constant) | `id` equals the passed options.id ✅ |
| HS-S3 | defaults the name when none is provided; honors a caller-supplied name | both branches ✅ |
| HS-S4 | uses the session-complete event type, not prompt-submit | `eventType` is the session-complete type ✅ |
| HS-S5 | uses the independently-chosen backend (not derived from the agent) | claude→`'claude'`, codex→`'codex'` ✅ |
| HS-S6 | references the task manager's MCP server name | `mcpServers = [taskManager.mcpServerName]` ✅ |
| HS-S7 | defaults to read-only sandbox | `sandbox = 'read-only'` ✅ |
| HS-S8 | uses the default review-subtask prompt text | `rule = DEFAULT_HANDOFF_RULE_TEXT` ✅ |
| HS-S9 | is enabled by default | `enabled = true` ✅ |
| HS-S10 | references agent + task manager labels in notes | notes contain both labels ✅ |
| HS-S11 | passes validation through `RuleSchema` | `RuleSchema.parse(rule)` does not throw ✅ |

`applyComboFieldsToRule` (update, preserving user edits):

| # | Case | Expected |
| --- | --- | --- |
| HS-U1 | overwrites only the combo-owned trigger / servers / backend | all three updated ✅ |
| HS-U2 | preserves user-edited prompt, model, reasoning effort, notes | all preserved ✅ |
| HS-U3 | preserves the existing id and enabled flag | both preserved ✅ |
| HS-U4 | updates name when provided, preserves it otherwise | both branches ✅ |
| HS-U5 | result passes `RuleSchema` validation | parse does not throw ✅ |

### Combos repository — `CombosRepository` (`src/main/db/repositories/combos.ts`)
**Status:** ✅ covered — `src/main/db/repositories/combos.test.ts` (11 cases).

| # | Case | Expected |
| --- | --- | --- |
| HS-CR1 | creates and retrieves a combo | round-trips all fields ✅ |
| HS-CR2 | lists combos newest-first | order by `created_at DESC` ✅ |
| HS-CR3 | update changes user-editable fields (label/agent/TM/backend), leaves ruleId + enabled | fields changed; ruleId + enabled untouched ✅ |
| HS-CR4 | update on a missing id returns false | `false` ✅ |
| HS-CR5 | setEnabled flips the flag and persists | toggles ✅ |
| HS-CR6 | setEnabled on a missing id returns false | `false` ✅ |
| HS-CR7 | delete removes a combo | row gone; second delete returns false ✅ |
| HS-CR8 | normalizes a non-0/1 enabled integer to false (defensive read) | `enabled === 1` only ✅ |
| HS-CR9 | rejects a create with an unknown agent id (FK RESTRICT) | throws ✅ |
| HS-CR10 | rejects a create with an unknown task-manager id (FK RESTRICT) | throws ✅ |
| HS-CR11 | deleting a rule cascades to delete combos referencing it (FK CASCADE) | combo gone after rule deleted ✅ |

### Migration 006 — `006_handoff_combos.sql`
**Status:** ✅ verified via ad-hoc node script (4 scenarios).

| # | Case | Expected |
| --- | --- | --- |
| HS-M1 | fresh DB (no app_settings row) → zero combos migrated | count = 0 ✅ |
| HS-M2 | legacy singleton complete + rule row present → one combo migrated | row reuses `handoff-auto` rule id ✅ |
| HS-M3 | legacy singleton complete but rule row missing → nothing migrated | count = 0 (guarded by `IN (SELECT id FROM rules)`) ✅ |
| HS-M4 | legacy singleton incomplete (missing backend) → nothing migrated | count = 0 ✅ |

---

## Integration — IPC handlers

### Combos — `ipc/combos.ts`

CRUD handlers that coordinate the combo + its owned rule. Mocks `electron`'s
`ipcMain` via `vi.mock` to capture handlers.

**Status:** ✅ covered — `src/main/ipc/combos.test.ts` (10 cases).

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| HS-CI1 | create builds the rule + combo, broadcasts onRulesChanged | invoke `create` valid | `ok=true`; rule exists with correct trigger/backend/mcpServers/name; onRulesChanged called ✅ |
| HS-CI2 | create returns ok=false for unknown agent | invoke with `agentId='ghost'` | `ok=false`; error mentions "Unknown agent" ✅ |
| HS-CI3 | create returns ok=false for unknown task manager | invoke with `taskManagerId='ghost'` | `ok=false`; error mentions "Unknown task manager" ✅ |
| HS-CI4 | create returns ok=false when the TM's MCP server is missing | pre-delete the server | `ok=false`; error mentions "missing MCP server" ✅ |
| HS-CI5 | supports multiple combos (multi-combo model) | create two with different agents | distinct ids + distinct rule ids + distinct event types ✅ |
| HS-CI6 | update patches combo-owned fields AND preserves user prompt/model edits | edit rule's prompt+model, then update combo | trigger/backend/name changed; prompt+model preserved ✅ |
| HS-CI7 | update returns ok=false for a missing combo | invoke with unknown id | `ok=false`; "not found" ✅ |
| HS-CI8 | setEnabled mirrors the flag onto the owned rule | disable a combo | rule.enabled also false ✅ |
| HS-CI9 | delete removes both the combo and its owned rule | create then delete | both gone ✅ |
| HS-CI10 | list + get return combos | create then list/get | shapes correct ✅ |

### Catalog IPC — `ipc/catalog.ts`

Unchanged from before. CRUD handlers for `agents:*` and `task-managers:*`; the
combo editor's pickers call these (including "+ Add custom…").

---

## E2E (Playwright) — Combos tab + Home

**Status:** ✅ covered — `playwright/combos.spec.ts` (10 cases) on the shared isolation fixture. Replaces the old `playwright/onboarding.spec.ts` (which tested the removed wizard). The shared fixture's `completeOnboarding` helper now creates a combo via the Combos tab.

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| HS-E1 | App opens to the shell on first launch (no wizard) | Launch with empty DB | Shell renders; Combos tab present and shows empty state ✅ |
| HS-E2 | Create a combo | New combo → pick agent/TM/backend → Create | Row appears; owned rule exists (verified via IPC) ✅ |
| HS-E3 | Create a second combo with a different agent | create a Codex combo | Two rows; two rules with distinct backends ✅ |
| HS-E4 | Edit a combo (switch agent) | Edit → select Codex → Save changes | Row still present ✅ |
| HS-E5 | Toggle a combo off | Switch in the table | Switch reflects `aria-checked=false` ✅ |
| HS-E6 | Delete a combo | Delete → confirm | Row gone ✅ |
| HS-E7 | "+ Add custom agent" inside the combo editor | picker → Add custom → Save | New agent selectable ✅ |
| HS-E9 | Home shows combo summary after creating one | navigate to Home | Label + agent + task manager shown ✅ |
| HS-E10 | Home "Manage combos" navigates to Combos tab | click button | Combos heading visible ✅ |

> HS-E8 ("+ Add custom task manager") is not yet automated — the editor flow
> for a custom task manager mirrors the custom-agent one (HS-E7) and is covered
> manually.

---

## Manual test plan

Run after any change to the setup builder, combos repo/IPC, the migration, or
the Combos/Home UI.

1. **Fresh launch (empty DB).** Confirm the shell appears directly (no wizard);
   the Combos tab is present and empty; Home shows the empty-combos prompt.
2. **Create a ZCode → OmniFocus combo.** Combos → New combo → ZCode → OmniFocus
   → Claude → Create. Confirm the row appears and a rule exists in Rules
   (Advanced) with trigger `zcode.session-complete`, backend `claude`, mcpServers
   `['omnifocus']`.
3. **Create a second Codex → OmniFocus combo.** Confirm both rows coexist and
   each has its own rule with its own event type.
4. **Handoff end-to-end (per agent).** Register a handoff with `parentTaskId`
   for a real session id. Complete a ZCode session → confirm a run fires the
   ZCode combo's rule. Complete a Codex session → confirm the Codex combo's rule
   fires independently.
5. **Edit a combo preserves user rule edits.** In Rules (Advanced), edit the
   combo's rule prompt + model. Back in Combos, edit the combo to switch agent.
   Confirm the rule's trigger/backend updated but the prompt + model are intact.
6. **Toggle + delete.** Disable a combo → confirm its rule stops firing on
   session-complete. Delete a combo → confirm its rule is gone from Rules.
7. **Add a custom task manager / agent** via the combo editor's "+ Add custom…"
   and confirm immediate selectability.
8. **Legacy upgrade.** On a DB with a pre-existing singleton setup (four
   `handoff*` settings + a `handoff-auto` rule), upgrade. Confirm one combo
   `combo-handoff-auto` appears, reusing the existing rule.
9. **Legacy upgrade (broken state).** On a DB with the singleton settings but
   the `handoff-auto` rule already deleted, upgrade. Confirm no combo is created
   and the app still launches cleanly (Combos tab empty).
