# Rules

A **rule** is a natural-language instruction that an agent (Claude or Codex) executes on your behalf. It is the heart of LocalCortex: you describe _what_ you want in plain English, and the app handles _when_ to run it, _which_ tools the agent may use, and _how_ to stop it.

> The rule **is** the spec. Everything about _what_ to look at, _what_ condition to check, and _what_ to do lives in the rule text — not in structured fields. The only structured fields are the ones the app genuinely needs to run the agent. See [design: scope is natural language](../../architecture.md#33-scope-is-natural-language-not-structured).

This document is the home for the **rule config format**: the field reference, the TypeScript types, and the validation rules enforced on save. How a rule *fires*, *stops*, and *runs* is covered by the sibling feature docs linked below.

---

## Anatomy of a rule

```jsonc
{
  "id": "r_gitlab_mr_reminder",
  "name": "Remind me to merge completed MRs",
  "enabled": true,

  "rule": "Fetch the status of merge request !23494 from GitLab. If it has been completed (merged), create a Todoist task under the 'Engineering' project titled 'Merge MR !23494'.",

  "trigger": { "type": "tick", "intervalSeconds": 3600 },     // → [Triggers]
  "mcpServers": ["gitlab", "todoist"],                         // → [MCP sources]
  "backend": "claude",                                         // → [Agent backends]

  "model": "gpt-5.5",                                          // → [Model & reasoning effort] (Codex only)
  "modelReasoningEffort": "medium",                            // → [Model & reasoning effort] (Codex only)

  "workdir": "/Users/colin/code/web-app",
  "sandbox": "read-only",

  "maxRuns": 48,                                               // → [Stop conditions]
  "expiresAt": "2026-07-14T00:00:00Z",
  "notes": "Created 2026-07-07. One-off MR watch."
}
```

### Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Human-readable label, shown in the rule list. |
| `rule` | yes | The natural-language instruction. Non-empty. See [What the rule text is responsible for](#what-the-rule-text-is-responsible-for). |
| `trigger` | yes | How the rule fires — `tick` (schedule) or `event` (HTTP). See [Triggers](../triggers/README.md). |
| `mcpServers` | yes | Which MCP servers to attach (curates the agent's toolset). Non-empty; every name must exist in the `mcp_servers` table. See [MCP sources](../mcp-sources/README.md). |
| `backend` | yes | `claude` or `codex`. See [Agent backends](../agent-backends/README.md). |
| `enabled` | no (default `true`) | Whether the scheduler/ingress will fire the rule. |
| `model` | no (Codex only) | Per-rule Codex model id override; omit to inherit the app default. See [Model & reasoning effort (Codex)](#model--reasoning-effort-codex). |
| `modelReasoningEffort` | no (Codex only) | Per-rule Codex reasoning-effort override (`minimal`/`low`/`medium`/`high`/`xhigh`); omit to inherit the app default. See [Model & reasoning effort (Codex)](#model--reasoning-effort-codex). |
| `workdir` | no | Directory the agent runs in. Omit for a per-rule scratch dir. See [Workdir](#workdir). |
| `sandbox` | no (default `read-only`) | `read-only` or `workspace-write`. Filesystem blast radius only (MCP writes are governed by `mcpServers`). See [Agent backends → Sandbox](../agent-backends/README.md#sandbox-filesystem-blast-radius). |
| `maxRuns` | no | Positive integer backstop, or `null` for unlimited. See [Stop conditions](../stop-conditions/README.md). |
| `expiresAt` | no | ISO timestamp after which the rule auto-disables. See [Stop conditions](../stop-conditions/README.md). |
| `notes` | no | Free-form human notes. |

`id` is assigned by the app and is immutable.

### What the rule text is responsible for

Because the rule is the spec, its text must convey three things:

1. **What to look at** — "merge request !23494", "open PRs assigned to me in acme/web-app", "the files changed in this session".
2. **What condition to check** — "merged", "in review >24h without approval", "action required from me".
3. **What to do** — "create a Todoist task under Engineering titled …", "create an OmniFocus task under Code Review".

For **event-triggered** rules, the text may also use `{{variable}}` placeholders that render from the incoming event payload. See [Triggers → Template variables](../triggers/README.md#template-variables-event-rules-only).

Everything else — the status contract and the available tool list — is appended by the app. See [Prompt contract (app-assembled)](#prompt-contract-app-assembled) below.

---

## Prompt contract (app-assembled)

At run time the prompt builder wraps the user's `rule` text with two things the user does **not** write:

- **The status contract** — a required machine-readable status block the agent must emit at the end of its final message:
  > *"At the end of your response, emit a JSON block on its own line: `{\"status\":\"<active|done|error>\",\"reason\":\"<short explanation>\"}`. Use `active` if the rule's goal is not yet met, `done` if it has been achieved or is no longer relevant, and `error` if you could not complete the task."*

  The app parses this block to decide whether to keep the rule active. See [Stop conditions](../stop-conditions/README.md) and [architecture §6.6](../../architecture.md#66-stop-conditions--agent-signaled-completion--structural-backstop).

- **The available MCP tools** — the list of servers attached (from `mcpServers`), so the agent knows what it can call.

Users write only the natural-language part. Both contract elements are appended by the app. See [`src/main/agent/prompt-builder.ts`](../../../src/main/agent/prompt-builder.ts).

> **⚠️ Known limitation — no cross-run write deduplication.** Each agent run is a fresh session with no memory of prior runs, and the app does **not** track which writes have already been performed, so the agent has no way to know it already created a task on a previous cycle. The status contract stops a rule after its goal is met (so *one-off* rules generally create each task exactly once), but for **ongoing rules** (status stays `active` indefinitely), or if status parsing ever fails, the agent may create duplicate tasks on each run. De-duplicate manually in the task manager. See [architecture §8](../../architecture.md#8-known-constraints--risks).

---

## Model & reasoning effort (Codex)

Two optional fields let a **Codex** rule override the app-level model defaults:

```jsonc
"model": "gpt-5.6-sol",                  // free-text model id; omit = app default (gpt-5.5)
"modelReasoningEffort": "xhigh"          // minimal | low | medium | high | xhigh; omit = app default (medium)
```

Resolution at run time (same `??` fallback pattern as `trigger.intervalSeconds`):

```
model           = rule.model              ?? settings.codexModel              (default: gpt-5.5)
reasoningEffort = rule.modelReasoningEffort ?? settings.codexReasoningEffort  (default: medium)
```

- **Codex-only.** The Claude backend ignores both fields (it has a `model` but no effort concept — see [Agent backends](../agent-backends/README.md#what-the-backend-controls)).
- **`model` is free-text** so new model ids work without a code change, but the Codex binary/SDK must support the id or the run fails with an API error.
- **Omit both to inherit the app default.** This is how the auto-created handoff rule works — it leaves both blank and tracks the app default automatically. See [Settings → Codex model / reasoning effort](../settings/README.md#codex-model--reasoning-effort-defaults).

---

## Workdir

The directory the agent's session runs from:

```jsonc
"workdir": "/Users/colin/code/my-repo"
```

If omitted, the app stages a per-rule scratch directory. Honored by both backends (Claude passes it as `options.cwd`; Codex as `startThread`'s `workingDirectory`). For event-triggered rules whose event carries a `workdir`, note the agent's run directory is set at config time — it is **not** rendered from the event. Set `workdir` explicitly if you want the agent to run *in* the session's directory. See [Agent backends → What the backend controls](../agent-backends/README.md#what-the-backend-controls) and [architecture §6.1](../../architecture.md#61-working-directory--first-class-rule-field).

---

## Using the Rules view

The **Rules** tab is the default landing view.

### Create a rule
1. Click **New rule** (top-right of the rules table).
2. Fill in the form: name, the natural-language **Rule** text, trigger type, MCP servers (comma-separated), backend, sandbox, and the optional backstops.
3. Click **Create**.

The form validates the required fields client-side; the main process re-validates with Zod before saving (see [Validation rules](#validation-rules-enforced-on-save)). Invalid input shows an inline error.

### Edit a rule
Click **Edit** on any row. Editing a tick-triggered rule reschedules it at its (possibly new) interval.

### Enable / disable
Toggle the **Enabled** switch on a row. Disabling keeps the rule and its history. Re-enabling **resets the run counter** (so `maxRuns` starts fresh) and clears the disable reason.

### Run now
Click **Run** to fire a rule immediately outside its schedule. For event-triggered rules, this runs with no event payload (template variables render empty).

### Delete
Click **Delete** and confirm. Deletion cascades to the rule's run history (the `runs` rows are removed with it).

---

## Validation rules (enforced on save)

Enforced by the app before a rule is saved or run (implemented as Zod checks in [`src/shared/schemas/rule-schema.ts`](../../../src/shared/schemas/rule-schema.ts)):

1. `trigger` is required and must be a valid type (`tick` or `event`).
2. Tick: `intervalSeconds`, if set, must be ≥ **300** (5-minute floor — every tick is a full agent run).
3. Event: `eventType` is required and non-empty.
4. `mcpServers` is required and non-empty. Every name must exist in the `mcp_servers` table **and** hold no `<your-token-here>` placeholder.
5. `rule` must be non-empty.
6. `maxRuns`, if set, must be a positive integer (or `null` for unlimited).
7. `expiresAt`, if set, must be a valid ISO timestamp in the future.
8. `sandbox === "workspace-write"` should prompt the user to confirm (filesystem write access to `workdir`).

Cross-table validation (mcpServers existing, placeholders filled) happens at **run time**, so a rule can be saved referencing a server you haven't configured yet — it just won't run until you do. See [MCP sources → How rules resolve servers](../mcp-sources/README.md#how-rules-resolve-servers).

---

## Worked examples

### One-off: poll a GitLab MR until it merges (tick)
```
name:  Remind me to merge MR !23494
rule:  Fetch the status of merge request !23494 from GitLab. If it has been
       completed (merged), create a Todoist task under the 'Engineering'
       project titled 'Merge MR !23494'.
trigger: tick, intervalSeconds 3600
mcpServers: gitlab, todoist
backend: claude
maxRuns: 48
expiresAt: 2026-07-14T00:00:00Z
```
The agent re-checks hourly, creates the task once, and signals `done` — which disables the rule. `maxRuns`/`expiresAt` are the backstop in case the agent never signals.

### Standing watch: review completed Codex sessions (event)
```
name:  Review completed Codex sessions
rule:  A Codex coding session just completed in {{workdir}} with summary:
       {{summary}}. Read the changed files, determine what action (if any)
       is required from me, and create an OmniFocus task under 'Code Review'
       describing it. If no action is needed, do nothing.
trigger: event, eventType codex.session-complete
mcpServers: todoist
backend: claude
maxRuns: null   // react to every matching session, indefinitely
```
See [Triggers](../triggers/README.md) for how `{{workdir}}` and `{{summary}}` render from the event payload.

---

## TypeScript types

Types are derived from the Zod schemas (the single source of truth) via `z.infer` — see [`src/shared/schemas/rule-schema.ts`](../../../src/shared/schemas/rule-schema.ts) and [`src/shared/types.ts`](../../../src/shared/types.ts). The shape:

```ts
export type AgentBackend = "claude" | "codex";
export type SandboxMode = "read-only" | "workspace-write";
export type TriggerType = "tick" | "event";
/**
 * A server name as defined in the mcp_servers table.
 * Open-ended (any string the user defined) — see MCP sources.
 */
export type McpServerName = string;

export type Rule = z.infer<typeof RuleSchema>;        // full field set below
export type Trigger = TickTrigger | EventTrigger;

export interface TickTrigger {
  type: "tick";
  intervalSeconds?: number;            // falls back to global default; ≥ 300
}

export interface EventTrigger {
  type: "event";
  eventType: string;                   // e.g. "codex.session-complete"
  filter?: Record<string, string>;     // optional glob filters on event payload fields
}
```

The `Rule` type (from `RuleSchema`) carries, in addition to the trigger and `mcpServers` shown above: `id`, `name`, `enabled`, `rule`, `backend`, optional `model` + `modelReasoningEffort` (Codex), optional `workdir`, `sandbox` (default `"read-only"`), optional `maxRuns` (`number | null`), optional `expiresAt`, and optional `notes`. A `RuleWithBookkeeping` (run count, disable reason, timestamps) is returned by the list/get IPC handlers.

---

## Gotchas

- **No cross-run write deduplication.** Each run is a fresh session with no memory of prior writes. One-off rules are protected by the status contract (a `done` rule stops before re-creating), but **ongoing rules** (status stays `active`) may create duplicate tasks each cycle. De-duplicate manually in the task manager. See [Prompt contract](#prompt-contract-app-assembled) and [architecture §8](../../architecture.md#8-known-constraints--risks).
- **Auto-execute.** Writes happen immediately on the agent's decision — there is no pre-approval gate. Use [Observability](../observability/README.md) to review what happened, and keep blast radius small via `mcpServers` + `sandbox`.
- **Saving a rule ≠ it can run.** A rule referencing an undefined MCP server saves fine but fails at run time with a clear error. Use the [Sources](../mcp-sources/README.md) view to validate.

## Related
- [Triggers](../triggers/README.md) — how and when a rule fires.
- [MCP sources](../mcp-sources/README.md) — the `mcpServers` field in detail.
- [Agent backends](../agent-backends/README.md) — the `backend`, `workdir`, and `sandbox` fields.
- [Stop conditions](../stop-conditions/README.md) — `maxRuns`, `expiresAt`, and the status contract.
- [Settings](../settings/README.md) — app-level defaults that rule fields fall back to.
- [Rules test plan](./test-plan.md).
