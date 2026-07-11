# Handoff setup

The **handoff setup** is the first-run experience that specializes LocalCortex
around its core use case: creating review subtasks automatically when a coding
agent finishes a task. On first launch, the user makes three choices and the app
auto-creates the underlying rule + MCP server wiring so the
[handoff pipeline](../handoffs/README.md) works out of the box.

---

## The three choices

Onboarding is a four-step wizard. Steps 1–3 are the three **orthogonal** choices;
step 4 is a review/confirm screen.

| Step | Choice | What it determines |
| --- | --- | --- |
| 1 | **Coding agent** | The *event source* — which `session-complete` event type the rule listens to. |
| 2 | **Task manager** | The *sink* — which MCP server the rule uses to create the review subtask. |
| 3 | **Review-rule backend** | Which runner (Claude SDK or Codex SDK) *fulfills* the rule. |
| 4 | **Review & confirm** | Shows the agent's install instructions + the task manager's setup instructions, then finishes. |

The three choices are **independent**. The agent you work in (e.g. ZCode) does
not determine which SDK runs the review rule — you can use ZCode as your working
agent and have the Codex SDK fulfill the review subtask, or vice versa.

Onboarding is "complete" when all three are set. The app stores them in settings
(`handoffAgentId`, `handoffTaskManagerId`, `handoffBackend`) and gates the main
shell behind the wizard until they're set.

---

## What the setup creates

When the user clicks **Finish**, `handoff-setup:complete` atomically:

1. **Validates** the three choices against the DB catalog (agent, task manager,
   and the task manager's referenced MCP server all exist).
2. **Creates or updates** the handoff rule (a normal `Rule`, id
   `handoff-auto`) with:
   - `trigger: { type: 'event', eventType: <agent>.sessionCompleteEventType`
   - `backend: <chosen backend>`
   - `mcpServers: [<task manager>.mcpServerName]`
   - `sandbox: 'read-only'`
   - A default review-subtask prompt that renders `{{parentTaskId}}` from the
     handoff context.
3. **Persists** the choices + rule id to settings.
4. **Broadcasts** `rules:changed` so the scheduler refreshes.

The rule is a **normal rule** — fully editable in the Rules tab (Advanced). It
runs through the existing ingress → matcher → run-loop path. No new execution
code was added for this feature.

Re-running setup (via Home → "Change setup" or Settings → "Reset setup") updates
the same rule in place (idempotent by the fixed `handoff-auto` id).

---

## The DB catalog

Agents, task managers, and MCP servers are all **DB-backed catalogs**, seeded by
[migration 004](../../../src/main/db/migrations/004_catalog.sql). Each is
CRUD-able in-app. This is the **zero-code extensibility path**:

### Adding a task manager (no code change)

1. **Sources** tab → "Add server" → add the MCP server (form or paste JSON from
   the server's README).
2. Onboarding step 2 (or the catalog form) → "Add custom…" → fill in the label,
   description, select the MCP server, and provide setup instructions.

The task manager is immediately selectable in onboarding. The run-loop resolves
its MCP server from the same `mcp_servers` table at run time.

### Adding a coding agent (no code change)

1. Onboarding step 1 (or the catalog form) → "Add custom…" → fill in the label,
   event types (`myagent.session-complete`, `myagent.prompt-submit`), source, and
   install instructions.
2. **On the agent side**, the user must install whatever hook/plugin makes the
   agent emit those events (same as today — the app does not manage hook
   deployment).

The agent is immediately selectable in onboarding.

### Adding a fulfilling backend (code change)

This is the one exception: adding a new SDK (e.g. a hypothetical "Gemini" runner)
requires code — extend the `AgentBackend` enum, add a runner class, and add a
branch in `buildRunnerProvider`. This is the [agent-layer extension path](../agent-backends/README.md).

---

## The onboarding gate

`App.tsx` evaluates whether setup is complete after settings load. If incomplete,
the wizard renders instead of the tabbed shell:

```
?view=handoff-prompt  → <HandoffPrompt/>   (popup, unchanged)
setup incomplete       → <Onboarding/>
otherwise              → <Shell/>
```

The wizard does not render before the settings DB read returns (no flash of the
wrong screen).

---

## Shell layout after onboarding

The main window is organized around the handoff use case:

- **Home** (default tab) — status card (agent, task manager, backend, rule
  state) + recent handoffs + "Change setup".
- **Handoffs** — the existing handoff list panel.
- **Run history** — the existing run observability view.
- **Rules** *(Advanced)* — the existing rule editor. The auto-created
  `handoff-auto` rule is visible and editable here.
- **Sources** *(Advanced)* — the MCP server CRUD table (replaces the old
  file viewer).
- **Settings** — global settings + a "Handoff setup" section showing the current
  choices with a reset button.

---

## MCP servers: from file to DB

This feature retired the static `~/.localcortex/mcp-servers.json` file. MCP
server definitions now live in the `mcp_servers` DB table — the single source of
truth. The Sources tab provides a CRUD interface with two input modes:

- **Form mode:** name, command, args (one per line), env key/value rows.
- **JSON-paste mode:** paste the exact `{ command, args, env }` block (the same
  shape as the old file entry), parsed into the row.

On upgrade, a one-time import reads any existing `mcp-servers.json` and inserts
its servers (idempotent by name), preserving real tokens. See
[mcp-sources](../mcp-sources/README.md) for details.

The MCP *machinery* (resolver, per-backend serialization, lifecycle manager,
run-loop) is unchanged — it consumes the same config object shape, just sourced
from the DB instead of a file.

---

## Related

- [Handoffs](../handoffs/README.md) — the review-subtask pipeline this setup powers.
- [Rules](../rules/README.md) — the auto-created rule is a normal rule.
- [MCP sources](../mcp-sources/README.md) — the DB-backed MCP server catalog.
- [Agent backends](../agent-backends/README.md) — the Claude/Codex runners.
- [Settings](../settings/README.md) — global settings, now including handoff fields.
