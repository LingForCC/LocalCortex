# Combos & handoff setup

A **combo** binds together the three choices that specialize LocalCortex around
its core use case — creating review subtasks automatically when a coding agent
finishes a task:

| Choice | What it determines |
| --- | --- |
| **Coding agent** | The *event source* — which `session-complete` event type the rule listens to. |
| **Task manager** | The *sink* — which MCP server the rule uses to create the review subtask. |
| **Review-rule backend** | Which runner (Claude SDK or Codex SDK) *fulfills* the rule. |

You can configure **multiple combos** and run them simultaneously. Each combo
owns its own auto-created rule, and because each agent emits a *distinct*
`session-complete` event type (`zcode.session-complete`, `codex.session-complete`,
…), the matcher fires every matching rule independently. So you can have one
combo routing ZCode sessions to OmniFocus and another routing Codex sessions to
OmniFocus — both active at the same time, each configured separately.

> Previously this feature was a **singleton**: exactly one combo, stored as four
> scalar fields on `app_settings` plus one fixed-id rule (`handoff-auto`), set up
> via a first-run onboarding wizard. Migration 006 moves to the multi-combo
> model: combos live in their own table, the wizard is gone, and any existing
> singleton setup is migrated into one combo row (see §Migration below).

---

## The three choices (orthogonal)

The three choices are **independent**. The agent you work in (e.g. ZCode) does
not determine which SDK runs the review rule — you can use ZCode as your working
agent and have the Codex SDK fulfill the review subtask, or vice versa.

A common multi-combo layout:

| Combo | Agent | Task manager | Backend |
| --- | --- | --- | --- |
| ZCode → OmniFocus | ZCode | OmniFocus | Claude |
| Codex → OmniFocus | Codex | OmniFocus | Codex |

Both fire independently on their own agent's `session-complete` events.

---

## Managing combos

Combos are managed in the **Combos** tab (a primary tab in the shell). The UI is
a standard list-CRUD table (mirrors Rules / Sources):

- Each row shows the combo's label, agent, task manager, backend, an enable/disable
  switch, and Edit / Delete actions.
- **New combo** / **Edit** opens an inline editor with a label field and the three
  pickers (agent, task manager, backend), reusing the same catalog picker
  primitives (including "+ Add custom…") as before.
- There is **no first-run wizard** and no onboarding gate — the app opens to the
  normal shell, and an empty combo list simply prompts you to create one from the
  Combos tab (or via Home → "Manage combos").

The Home tab summarizes the configured combos and recent handoffs.

---

## What creating a combo does

When you save a new combo, `combos:create` atomically:

1. **Validates** the three choices against the DB catalog (agent, task manager,
   and the task manager's referenced MCP server all exist).
2. **Builds** a fresh rule (a normal `Rule`, per-combo UUID id) with:
   - `trigger: { type: 'event', eventType: <agent>.sessionCompleteEventType }`
   - `backend: <chosen backend>`
   - `mcpServers: [<task manager>.mcpServerName]`
   - `sandbox: 'read-only'`
   - A default review-subtask prompt that renders `{{parentTaskId}}` from the
     handoff context.
3. **Inserts** the rule, then the combo row (which references the rule via
   `rule_id`).
4. **Broadcasts** `rules:changed` so the scheduler refreshes.

The rule is a **normal rule** — fully editable in the Rules tab (Advanced). It
runs through the existing ingress → matcher → run-loop path. No new execution
code was added for this feature.

### Combo ↔ rule ownership invariant

The combo **owns** its rule but **preserves your edits**:

- **Update combo** (agent / task manager / backend / label changed) → only the
  combo-owned rule fields are overwritten (`trigger.eventType`, `mcpServers`,
  `backend`, `name`). Your edits to the prompt, model, reasoning effort, sandbox,
  workdir, maxRuns, expiresAt, and notes are preserved.
- **Toggle enabled** → the flag is mirrored onto both the combo and its rule (the
  scheduler fires rules, not combos, so the rule's `enabled` is what counts).
- **Delete combo** → the rule is deleted first, then the combo.

---

## Storage: the `handoff_combos` table

Combos live in a dedicated table ([migration 006](../../../src/main/db/migrations/006_handoff_combos.sql)),
not in the `app_settings` JSON blob:

```sql
CREATE TABLE handoff_combos (
  id              TEXT PRIMARY KEY,
  label           TEXT NOT NULL,
  agent_id        TEXT NOT NULL,          -- FK -> agents(id)        ON DELETE RESTRICT
  task_manager_id TEXT NOT NULL,          -- FK -> task_managers(id) ON DELETE RESTRICT
  backend         TEXT NOT NULL,          -- 'claude' | 'codex'
  rule_id         TEXT NOT NULL,          -- FK -> rules(id)         ON DELETE CASCADE
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

FK enforcement is ON (`DB_PRAGMAS`), so a catalog row referenced by a combo
can't be deleted while the combo exists. The repository + IPC layers are the
only place that coordinates the combo and its rule (see the ownership invariant
above).

The four former `handoff*` fields have been **removed** from `AppSettings`.

---

## Migration of a legacy singleton setup

Migration 006 copies any pre-existing singleton setup into one combo row, reusing
the existing `handoff-auto` rule. It reads the four `handoff*` keys from the
`app_settings` JSON blob via `json_extract` and inserts a combo with
`id = 'combo-handoff-auto'` **only if**:

- all four fields are present and non-empty (the setup was complete), **and**
- the referenced rule row still exists in `rules` (guarded by an `IN (SELECT id
  FROM rules)` subquery, because an FK violation would otherwise abort the whole
  migration).

If the setup was incomplete or the rule was already gone, nothing is migrated —
the user simply starts fresh in the Combos tab. No data is lost in either case.

---

## The DB catalog

Agents, task managers, and MCP servers are all **DB-backed catalogs**, seeded by
[migration 004](../../../src/main/db/migrations/004_catalog.sql). Each is
CRUD-able in-app (the combo editor's "+ Add custom…" buttons). This is the
**zero-code extensibility path**:

### Adding a task manager (no code change)

1. **Sources** tab → "Add server" → add the MCP server (form or paste JSON from
   the server's README).
2. Combos tab → edit/create a combo → task manager picker → "Add custom…" → fill
   in the label, description, select the MCP server, and provide setup
   instructions.

The task manager is immediately selectable. The run-loop resolves its MCP server
from the same `mcp_servers` table at run time.

### Adding a coding agent (no code change)

1. Combos tab → edit/create a combo → agent picker → "Add custom…" → fill in the
   label, event types (`myagent.session-complete`, `myagent.prompt-submit`),
   source, and install instructions.
2. **On the agent side**, the user must install whatever hook/plugin makes the
   agent emit those events (the app does not manage hook deployment).

The agent is immediately selectable. One agent can be used by multiple combos.

### Adding a fulfilling backend (code change)

This is the one exception: adding a new SDK (e.g. a hypothetical "Gemini" runner)
requires code — extend the `AgentBackend` enum, add a runner class, and add a
branch in `buildRunnerProvider`. This is the [agent-layer extension path](../agent-backends/README.md).

---

## Shell layout

The main window is organized around the handoff use case:

- **Home** (default tab) — combo summary (each agent → task manager → backend +
  status) + recent handoffs + "Manage combos".
- **Combos** — the combo list-CRUD table.
- **Handoffs** — the existing handoff list panel.
- **Run history** — the existing run observability view.
- **Rules** *(Advanced)* — the existing rule editor. Each combo's auto-created
  rule is visible and editable here.
- **Sources** *(Advanced)* — the MCP server CRUD table.
- **Settings** — global settings (tick interval, concurrency, appearance, CLI
  paths, Codex model defaults).

There is no longer an onboarding gate — the shell always renders, and the popup
window branch (`?view=handoff-prompt`) is unchanged:

```
?view=handoff-prompt  → <HandoffPrompt/>   (popup, unchanged)
otherwise             → <Shell/>
```

---

## Related

- [Handoffs](../handoffs/README.md) — the review-subtask pipeline combos power.
- [Rules](../rules/README.md) — each combo's auto-created rule is a normal rule.
- [MCP sources](../mcp-sources/README.md) — the DB-backed MCP server catalog.
- [Agent backends](../agent-backends/README.md) — the Claude/Codex runners.
- [Settings](../settings/README.md) — global settings.
