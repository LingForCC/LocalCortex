# Handoff profiles — Test Plan

Covers the **handoff profiles** (agent + task-manager + backend) feature: the
**`handoff_profiles` table + repository**, the **profile builder** (pure
rule-building logic), the **handoff-profiles IPC** (CRUD + profile↔rule
orchestration), the **migration** from the legacy singleton setup, and the
**Handoff profiles / Home renderer UI**. The behavior of *running* a profile's
auto-created rule (matching, execution, stop conditions) is covered by
[Triggers](../triggers/test-plan.md), [Agent backends](../agent-backends/test-plan.md),
and [Stop conditions](../stop-conditions/test-plan.md). The MCP servers table,
Sources CRUD UI, and legacy file import are covered by
[MCP sources](../mcp-sources/test-plan.md).

---

## In scope

- **Profile builder** (`profile-builder.ts`): `buildHandoffProfileRule`
  (per-profile rule creation) and `applyProfileFieldsToRule` (update that
  preserves user edits).
- **Handoff profiles repository** (`handoff-profiles.ts`): CRUD + enable/disable
  + FK behavior.
- **Handoff profiles migration** (`006_handoff_profiles.sql`): table creation +
  legacy singleton migration (incl. the missing-rule guard).
- **Handoff profiles IPC** (`ipc/handoff-profiles.ts`): create/update/delete/
  setEnabled with the profile↔rule invariants (rule sync, prompt/model
  preservation, rule cleanup on delete).
- Agents + task-managers catalog repos + IPC (unchanged from before; still used
  by the profile editor's pickers).
- Renderer UI: the Handoff profiles tab (list + inline editor), Home summary,
  Settings (handoff card removed).

## Out of scope (covered elsewhere)

- Event-type matching (does `zcode.session-complete` match the rule?) → [Triggers](../triggers/test-plan.md).
- Agent execution of a profile's rule → [Agent backends](../agent-backends/test-plan.md).
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
| E2E (Electron) | Playwright | `playwright/*.spec.ts` |
| Manual | operator | — |

---

## Unit tests

### Profile builder — `buildHandoffProfileRule` + `applyProfileFieldsToRule` (`src/main/handoff-profiles/profile-builder.ts`)
**Status:** ✅ covered — `src/main/handoff-profiles/profile-builder.test.ts` (17 cases).

`buildHandoffProfileRule` (rule creation):

| # | Case | Expected |
| --- | --- | --- |
| HS-S1 | builds a rule with the correct event trigger from the agent | `trigger = { type: 'event', eventType: 'zcode.session-complete' }` ✅ |
| HS-S2 | uses the caller-supplied per-profile id (not a fixed constant) | `id` equals the passed options.id ✅ |
| HS-S3 | defaults the name when none is provided; honors a caller-supplied name | both branches ✅ |
| HS-S4 | uses the session-complete event type, not prompt-submit | `eventType` is the session-complete type ✅ |
| HS-S5 | uses the independently-chosen backend (not derived from the agent) | claude→`'claude'`, codex→`'codex'` ✅ |
| HS-S6 | references the task manager's MCP server name | `mcpServers = [taskManager.mcpServerName]` ✅ |
| HS-S7 | defaults to read-only sandbox | `sandbox = 'read-only'` ✅ |
| HS-S8 | uses the default review-subtask prompt text | `rule = DEFAULT_HANDOFF_RULE_TEXT` ✅ |
| HS-S9 | is enabled by default | `enabled = true` ✅ |
| HS-S10 | references agent + task manager labels in notes | notes contain both labels ✅ |
| HS-S11 | passes validation through `RuleSchema` | `RuleSchema.parse(rule)` does not throw ✅ |

`applyProfileFieldsToRule` (update, preserving user edits):

| # | Case | Expected |
| --- | --- | --- |
| HS-U1 | overwrites only the profile-owned trigger / servers / backend | all three updated ✅ |
| HS-U2 | preserves user-edited prompt, model, reasoning effort, notes | all preserved ✅ |
| HS-U3 | preserves the existing id and enabled flag | both preserved ✅ |
| HS-U4 | updates name when provided, preserves it otherwise | both branches ✅ |
| HS-U5 | result passes `RuleSchema` validation | parse does not throw ✅ |

### Handoff profiles repository — `HandoffProfilesRepository` (`src/main/db/repositories/handoff-profiles.ts`)
**Status:** ✅ covered — `src/main/db/repositories/handoff-profiles.test.ts` (11 cases).

| # | Case | Expected |
| --- | --- | --- |
| HS-CR1 | creates and retrieves a handoff profile | round-trips all fields ✅ |
| HS-CR2 | lists handoff profiles newest-first | order by `created_at DESC` ✅ |
| HS-CR3 | update changes user-editable fields (label/agent/TM/backend), leaves ruleId + enabled | fields changed; ruleId + enabled untouched ✅ |
| HS-CR4 | update on a missing id returns false | `false` ✅ |
| HS-CR5 | setEnabled flips the flag and persists | toggles ✅ |
| HS-CR6 | setEnabled on a missing id returns false | `false` ✅ |
| HS-CR7 | delete removes a handoff profile | row gone; second delete returns false ✅ |
| HS-CR8 | normalizes a non-0/1 enabled integer to false (defensive read) | `enabled === 1` only ✅ |
| HS-CR9 | rejects a create with an unknown agent id (FK RESTRICT) | throws ✅ |
| HS-CR10 | rejects a create with an unknown task-manager id (FK RESTRICT) | throws ✅ |
| HS-CR11 | deleting a rule cascades to delete profiles referencing it (FK CASCADE) | profile gone after rule deleted ✅ |

### Migration 006 — `006_handoff_profiles.sql`
**Status:** ✅ verified via ad-hoc node script (4 scenarios).

| # | Case | Expected |
| --- | --- | --- |
| HS-M1 | fresh DB (no app_settings row) → zero profiles migrated | count = 0 ✅ |
| HS-M2 | legacy singleton complete + rule row present → one profile migrated | row reuses `handoff-auto` rule id ✅ |
| HS-M3 | legacy singleton complete but rule row missing → nothing migrated | count = 0 (guarded by `IN (SELECT id FROM rules)`) ✅ |
| HS-M4 | legacy singleton incomplete (missing backend) → nothing migrated | count = 0 ✅ |

---

## Integration — IPC handlers

### Handoff profiles — `ipc/handoff-profiles.ts`

CRUD handlers that coordinate the profile + its owned rule. Mocks `electron`'s
`ipcMain` via `vi.mock` to capture handlers.

**Status:** ✅ covered — `src/main/ipc/handoff-profiles.test.ts` (10 cases).

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| HS-CI1 | create builds the rule + profile, broadcasts onRulesChanged | invoke `create` valid | `ok=true`; rule exists with correct trigger/backend/mcpServers/name; onRulesChanged called ✅ |
| HS-CI2 | create returns ok=false for unknown agent | invoke with `agentId='ghost'` | `ok=false`; error mentions "Unknown agent" ✅ |
| HS-CI3 | create returns ok=false for unknown task manager | invoke with `taskManagerId='ghost'` | `ok=false`; error mentions "Unknown task manager" ✅ |
| HS-CI4 | create returns ok=false when the TM's MCP server is missing | pre-delete the server | `ok=false`; error mentions "missing MCP server" ✅ |
| HS-CI5 | supports multiple profiles (multi-profile model) | create two with different agents | distinct ids + distinct rule ids + distinct event types ✅ |
| HS-CI6 | update patches profile-owned fields AND preserves user prompt/model edits | edit rule's prompt+model, then update profile | trigger/backend/name changed; prompt+model preserved ✅ |
| HS-CI7 | update returns ok=false for a missing profile | invoke with unknown id | `ok=false`; "not found" ✅ |
| HS-CI8 | setEnabled mirrors the flag onto the owned rule | disable a profile | rule.enabled also false ✅ |
| HS-CI9 | delete removes both the profile and its owned rule | create then delete | both gone ✅ |
| HS-CI10 | list + get return handoff profiles | create then list/get | shapes correct ✅ |

### Catalog IPC — `ipc/catalog.ts`

Unchanged from before. CRUD handlers for `agents:*` and `task-managers:*`; the
profile editor's pickers call these (including "+ Add custom…").

---

## E2E (Playwright) — Handoff profiles tab + Home

**Status:** ✅ covered — `playwright/handoff-profiles.spec.ts` (10 cases) on the shared isolation fixture. Replaces the old `playwright/onboarding.spec.ts` (which tested the removed wizard). The shared fixture's `completeOnboarding` helper now creates a profile via the Handoff profiles tab.

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| HS-E1 | App opens to the shell on first launch (no wizard) | Launch with empty DB | Shell renders; Handoff profiles tab present and shows empty state ✅ |
| HS-E2 | Create a handoff profile | New handoff profile → pick agent/TM/backend → Create | Row appears; owned rule exists (verified via IPC) ✅ |
| HS-E3 | Create a second profile with a different agent | create a Codex profile | Two rows; two rules with distinct backends ✅ |
| HS-E4 | Edit a profile (switch agent) | Edit → select Codex → Save changes | Row still present ✅ |
| HS-E5 | Toggle a profile off | Switch in the table | Switch reflects `aria-checked=false` ✅ |
| HS-E6 | Delete a profile | Delete → confirm | Row gone ✅ |
| HS-E7 | "+ Add custom agent" inside the profile editor | picker → Add custom → Save | New agent selectable ✅ |
| HS-E9 | Home shows profile summary after creating one | navigate to Home | Label + agent + task manager shown ✅ |
| HS-E10 | Home "Manage handoff profiles" navigates to Handoff profiles tab | click button | Handoff profiles heading visible ✅ |

> HS-E8 ("+ Add custom task manager") is not yet automated — the editor flow
> for a custom task manager mirrors the custom-agent one (HS-E7) and is covered
> manually.

---

## Manual test plan

Run after any change to the profile builder, handoff-profiles repo/IPC, the
migration, or the Handoff profiles / Home UI.

1. **Fresh launch (empty DB).** Confirm the shell appears directly (no wizard);
   the Handoff profiles tab is present and empty; Home shows the
   empty-profiles prompt.
2. **Create a ZCode → OmniFocus profile.** Handoff profiles → New handoff
   profile → ZCode → OmniFocus → Claude → Create. Confirm the row appears and a
   rule exists in Rules (Advanced) with trigger `zcode.session-complete`,
   backend `claude`, mcpServers `['omnifocus']`.
3. **Create a second Codex → OmniFocus profile.** Confirm both rows coexist and
   each has its own rule with its own event type.
4. **Handoff end-to-end (per agent).** Register a handoff with `parentTaskId`
   for a real session id. Complete a ZCode session → confirm a run fires the
   ZCode profile's rule. Complete a Codex session → confirm the Codex profile's
   rule fires independently.
5. **Edit a profile preserves user rule edits.** In Rules (Advanced), edit the
   profile's rule prompt + model. Back in Handoff profiles, edit the profile to
   switch agent. Confirm the rule's trigger/backend updated but the prompt +
   model are intact.
6. **Toggle + delete.** Disable a profile → confirm its rule stops firing on
   session-complete. Delete a profile → confirm its rule is gone from Rules.
7. **Add a custom task manager / agent** via the profile editor's "+ Add
   custom…" and confirm immediate selectability.
8. **Legacy upgrade.** On a DB with a pre-existing singleton setup (four
   `handoff*` settings + a `handoff-auto` rule), upgrade. Confirm one profile
   `profile-handoff-auto` appears, reusing the existing rule.
9. **Legacy upgrade (broken state).** On a DB with the singleton settings but
   the `handoff-auto` rule already deleted, upgrade. Confirm no profile is
   created and the app still launches cleanly (Handoff profiles tab empty).
