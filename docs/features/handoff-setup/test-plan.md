# Handoff setup — Test Plan

Covers the **onboarding wizard**, the **auto-created handoff rule** (pure setup
builder), the **agents and task-managers catalog** repos, the **handoff-setup
IPC** (`complete` / `reset`), and the onboarding/Home/Settings **renderer UI**.
The behavior of *running* the auto-created rule (matching, execution, stop
conditions) is covered by [Triggers](../triggers/test-plan.md), [Agent
backends](../agent-backends/test-plan.md), and [Stop
conditions](../stop-conditions/test-plan.md). The MCP servers table, Sources
CRUD UI, and legacy file import are covered by [MCP sources](../mcp-sources/test-plan.md).

---

## In scope

- **Setup builder** (`setup-builder.ts`): the pure `buildHandoffRule` function — trigger derivation, backend independence, MCP server reference, sandbox, prompt, idempotent id/name.
- **Agents catalog repository**: `AgentsRepository` (CRUD + seeding + ordering).
- **Task managers catalog repository**: `TaskManagersRepository` (CRUD + seeding + FK enforcement).
- **Settings extension**: the four handoff fields (`handoffAgentId`, `handoffTaskManagerId`, `handoffBackend`, `handoffRuleId`) round-trip through `SettingsRepository.get()` / `update()` / `clearHandoffFields()`.
- **Handoff-setup IPC** (`ipc/handoff-setup.ts`): `complete` (validate → persist → create-or-update rule → broadcast) and `reset` (clear settings without deleting the rule).
- **Agents + task-managers catalog IPC** (`ipc/catalog.ts`): CRUD channels for agents and task managers (validate-then-act).
- Renderer UI: the 4-step onboarding wizard, the Home dashboard, the shell onboarding gate, the Settings handoff-setup section.

## Out of scope (covered elsewhere)

- Event-type matching (does `zcode.session-complete` match the rule?) → [Triggers](../triggers/test-plan.md).
- Agent execution of the auto-created rule → [Agent backends](../agent-backends/test-plan.md).
- MCP server table (seeding, CRUD, `getAsConfig`, legacy import, placeholder detection) → [MCP sources](../mcp-sources/test-plan.md) (M-R1..R10).
- Sources tab UI (form + JSON-paste CRUD, edit builtin) → [MCP sources](../mcp-sources/test-plan.md) (M-E1..E6).
- MCP serialization (Claude/Codex wire formats) → [MCP sources](../mcp-sources/test-plan.md).
- Template rendering of `{{parentTaskId}}` → [Triggers](../triggers/test-plan.md) (`renderTemplate`).
- The handoff popup and enrichment pipeline → [Handoffs](../handoffs/test-plan.md).

---

## Test types

| Type | Tool | Where |
| --- | --- | --- |
| Unit (pure logic) | Vitest | `src/**/*.test.ts` |
| Integration (IPC with fake repos) | Vitest (`vi.mock('electron')`) | `src/**/*.test.ts` |
| E2E (Electron) | Playwright | `playwright/*.spec.ts` (planned) |
| Manual | operator | — |

---

## Unit tests

### Setup builder — `buildHandoffRule` (`src/main/handoff-setup/setup-builder.ts`)
**Status:** ✅ covered — `src/main/handoff-setup/setup-builder.test.ts` (10 cases).

| # | Case | Expected |
| --- | --- | --- |
| HS-S1 | builds a rule with the correct event trigger from the agent | `trigger = { type: 'event', eventType: 'zcode.session-complete' }` ✅ new |
| HS-S2 | uses the session-complete event type, not prompt-submit | `eventType` is the session-complete type ✅ new |
| HS-S3 | uses the independently-chosen backend (not derived from the agent) | claude→`'claude'`, codex→`'codex'` ✅ new |
| HS-S4 | references the task manager's MCP server name | `mcpServers = [taskManager.mcpServerName]` ✅ new |
| HS-S5 | defaults to read-only sandbox | `sandbox = 'read-only'` ✅ new |
| HS-S6 | uses the default review-subtask prompt text | `rule = DEFAULT_HANDOFF_RULE_TEXT` ✅ new |
| HS-S7 | uses the deterministic id and name | `id = HANDOFF_RULE_ID`, `name = HANDOFF_RULE_NAME` ✅ new |
| HS-S8 | is enabled by default | `enabled = true` ✅ new |
| HS-S9 | references agent + task manager labels in notes | notes contain both labels ✅ new |
| HS-S10 | passes validation through `RuleSchema` (no parse error) | `RuleSchema.parse(rule)` does not throw ✅ new |

### Agents repository — `AgentsRepository` (`src/main/db/repositories/agents.ts`)
**Status:** ✅ covered — `src/main/db/repositories/agents.test.ts` (7 cases).

| # | Case | Expected |
| --- | --- | --- |
| HS-A1 | seeds zcode and codex on migration | ids contain both ✅ new |
| HS-A2 | seeds agents with the correct event types + source | zcode has `session-complete`, `prompt-submit`, `source='zcode'` ✅ new |
| HS-A3 | creates and retrieves a custom agent | round-trips all fields; `isBuiltin=false` ✅ new |
| HS-A4 | lists builtin agents first, then custom | builtin indices < custom indices ✅ new |
| HS-A5 | updates an agent | changed field persists ✅ new |
| HS-A6 | deletes an agent | row removed ✅ new |
| HS-A7 | returns null for a nonexistent id | `get('nonexistent') = null` ✅ new |

### Task managers repository — `TaskManagersRepository` (`src/main/db/repositories/task-managers.ts`)
**Status:** ✅ covered — `src/main/db/repositories/task-managers.test.ts` (7 cases).

| # | Case | Expected |
| --- | --- | --- |
| HS-T1 | seeds omnifocus on migration | ids contain `omnifocus` ✅ new |
| HS-T2 | seeds omnifocus referencing the omnifocus mcp_servers row | `mcpServerName='omnifocus'`; `requiresToken=false`; `tokenEnvVar=null` ✅ new |
| HS-T3 | creates and retrieves a custom task manager | round-trips all fields including token info ✅ new |
| HS-T4 | lists builtin task managers first | builtin index < custom index ✅ new |
| HS-T5 | updates a task manager | changed field persists ✅ new |
| HS-T6 | deletes a task manager | row removed ✅ new |
| HS-T7 | enforces the FK: cannot create a task manager referencing a missing server | throws on create with nonexistent `mcpServerName` ✅ new |

---

## Integration — IPC handlers

### Handoff setup — `ipc/handoff-setup.ts`

`complete` and `reset` are async handlers that compose the DB catalog +
rules repo + settings repo. Mocks `electron`'s `ipcMain` via `vi.mock` to
capture handlers, same pattern as `ipc/handoffs.test.ts`.

**Status:** ✅ covered — `src/main/ipc/handoff-setup.test.ts` (8 cases).

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| HS-I1 | complete creates the rule + persists settings on valid input | invoke `complete` with zcode/omnifocus/claude | `ok=true`; rule exists with correct trigger/backend/mcpServers; settings persisted ✅ new |
| HS-I2 | complete broadcasts `onRulesChanged` after setup | invoke `complete` | `onRulesChanged` callback called ✅ new |
| HS-I3 | complete is idempotent: re-running updates, doesn't duplicate | invoke `complete` twice with different agents | only one rule with `HANDOFF_RULE_ID`; rule reflects latest choices ✅ new |
| HS-I4 | complete returns `ok=false` for an unknown agent id | invoke with `agentId='nonexistent'` | `ok=false`; error mentions "Unknown agent" ✅ new |
| HS-I5 | complete returns `ok=false` for an unknown task manager id | invoke with `taskManagerId='nonexistent'` | `ok=false`; error mentions "Unknown task manager" ✅ new |
| HS-I6 | complete returns `ok=false` for an invalid payload (missing fields) | invoke with `{ agentId: 'zcode' }` only | `ok=false`; error mentions "Invalid setup request" ✅ new |
| HS-I7 | reset clears the handoff settings fields | complete then reset | all four handoff fields `undefined` in settings ✅ new |
| HS-I8 | reset does NOT delete the rule (user may keep it) | complete then reset | rule still exists in rules repo ✅ new |

### Catalog IPC — `ipc/catalog.ts`

CRUD handlers for `agents:*` and `task-managers:*`. Each validates with a Zod
schema before acting (the standard pattern). The `mcp-servers:*` handlers in the
same file are covered by [MCP sources](../mcp-sources/test-plan.md) (M-I4, M-I5).

**Status:** not unit-tested (Electron-coupled; same gap as the existing `ipc/servers.ts`). Verify via E2E/manual.

| # | Case | Expected |
| --- | --- | --- |
| HS-C1 | `agents:create` inserts and returns the row | row retrievable via `agents:get` |
| HS-C2 | `task-managers:create` inserts and returns the row | row retrievable via `task-managers:get` |

---

## E2E (Playwright) — Onboarding wizard + Home + Settings

**Status:** ✅ covered — `playwright/onboarding.spec.ts` (12 cases) on the shared isolation fixture. Sources tab E2E (HS-E8..E11 in the original plan) lives in `playwright/sources.spec.ts` and is documented under [MCP sources](../mcp-sources/test-plan.md) (M-E1..E6) — no duplication here.

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| HS-E1 | First launch shows the wizard (not the shell) | Launch app with empty DB | Onboarding wizard appears, not the tabbed shell |
| HS-E2 | Complete onboarding creates the rule + transitions to shell | Select agent → task manager → backend → Finish | Shell appears with Home as default tab; `handoff-auto` rule exists |
| HS-E3 | Wizard step navigation (Back/Next) | Navigate forward and backward through steps | State preserved; Back returns to prior step |
| HS-E4 | "Add custom agent" form creates a row | Step 1 → Add custom → fill → Save | New agent appears in the picker |
| HS-E5 | "Add custom task manager" form creates a row | Step 2 → Add custom → fill → Save | New task manager appears in the picker |
| HS-E6 | Agent install instructions show on review step | Reach step 4 with an agent selected | Instructions text visible |
| HS-E7 | Task manager setup instructions show on review step | Reach step 4 with a task manager selected | Instructions text visible |
| HS-E12 | Home tab shows current setup + recent handoffs | Navigate to Home | Agent, task manager, backend, rule status shown |
| HS-E13 | Home "Change setup" re-opens onboarding | Click Change setup | Onboarding wizard appears |
| HS-E14 | Settings reset clears setup | Settings → Reset setup | Returns to onboarding on next render |

---

## Manual test plan

Run after any change to the setup builder, the catalog repos, the handoff-setup
IPC, or the onboarding wizard. Sources CRUD and legacy file import are covered
in the [MCP sources manual plan](../mcp-sources/test-plan.md#e2e--manual).

1. **First launch → onboarding.** Launch with a fresh DB. Confirm the 4-step wizard appears (not the shell).
2. **Complete setup (ZCode + OmniFocus).** Select ZCode → OmniFocus → Claude → Finish. Confirm: the shell appears, Home shows the correct choices, and the `handoff-auto` rule is visible in Rules (Advanced) with trigger `zcode.session-complete`, backend `claude`, mcpServers `['omnifocus']`.
3. **Handoff end-to-end.** Register a handoff for a real session id with `parentTaskId`. Complete the ZCode session. Confirm a run appears in Run history with `{{parentTaskId}}` rendered in the prompt.
4. **Change setup.** Home → Change setup. Re-run with Codex → OmniFocus → Codex. Confirm the same `handoff-auto` rule is updated in place (not duplicated) — trigger now `codex.session-complete`, backend `codex`.
5. **Add a custom task manager (zero-code).** Sources tab → add an MCP server (e.g. `todoist` with a real token). Then Home → Change setup → step 2 → Add custom → fill in referencing the server. Confirm it's immediately selectable and the rule switches to it on finish.
6. **Add a custom coding agent (zero-code).** Onboarding step 1 → Add custom → fill in event types + instructions. Confirm it's selectable. (The agent-side hook is the user's responsibility.)
7. **Reset setup.** Settings → Reset setup. Confirm the wizard re-appears. Confirm the `handoff-auto` rule is still present in Rules (not deleted) — re-running setup will overwrite it.
8. **Onboarding gate reactivity.** After completing setup, confirm the shell shows immediately (no stuck "Setting up…" state). After reset, confirm the wizard shows immediately without a manual reload.

---

## Related
- [Handoff setup README](./README.md)
- [Handoffs test plan](../handoffs/test-plan.md) (the pipeline this setup powers)
- [MCP sources test plan](../mcp-sources/test-plan.md) (the DB-backed MCP catalog)
- [Rules test plan](../rules/test-plan.md) (the auto-created rule is a normal rule)
