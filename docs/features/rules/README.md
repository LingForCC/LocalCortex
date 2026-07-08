# Rules

A **rule** is a natural-language instruction that an agent (Claude or Codex) executes on your behalf. It is the heart of LocalCortex: you describe _what_ you want in plain English, and the app handles _when_ to run it, _which_ tools the agent may use, and _how_ to stop it.

> The rule **is** the spec. Everything about _what_ to look at, _what_ condition to check, and _what_ to do lives in the rule text — not in structured fields. The only structured fields are the ones the app genuinely needs to run the agent. See [design: scope is natural language](../../architecture.md#33-scope-is-natural-language-not-structured).

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
| `rule` | yes | The natural-language instruction. Non-empty. |
| `trigger` | yes | How the rule fires — `tick` (schedule) or `event` (HTTP). See [Triggers](../triggers/README.md). |
| `mcpServers` | yes | Which MCP servers to attach (curates the agent's toolset). Non-empty; every name must exist in `mcp-servers.json`. See [MCP sources](../mcp-sources/README.md). |
| `backend` | yes | `claude` or `codex`. See [Agent backends](../agent-backends/README.md). |
| `enabled` | no (default `true`) | Whether the scheduler/ingress will fire the rule. |
| `workdir` | no | Directory the agent runs in. Omit for a per-rule scratch dir. Honored by both Claude and Codex; see [Agent backends](../agent-backends/README.md). |
| `sandbox` | no (default `read-only`) | `read-only` or `workspace-write`. Filesystem blast radius only (MCP writes are governed by `mcpServers`). |
| `maxRuns` | no | Positive integer backstop, or `null` for unlimited. See [Stop conditions](../stop-conditions/README.md). |
| `expiresAt` | no | ISO timestamp after which the rule auto-disables. |
| `notes` | no | Free-form human notes. |

`id` is assigned by the app and is immutable.

### What the rule text is responsible for

Because the rule is the spec, its text must convey three things:

1. **What to look at** — "merge request !23494", "open PRs assigned to me in acme/web-app", "the files changed in this session".
2. **What condition to check** — "merged", "in review >24h without approval", "action required from me".
3. **What to do** — "create a Todoist task under Engineering titled …", "create an OmniFocus task under Code Review".

The app appends two things the user does **not** write: the **status contract** (requires the agent to emit `{"status":"active|done|error"}`) and the list of **available MCP tools**. See [design: prompt contract](../../rule-config-schema.md#2-rule--natural-language-instruction).

---

## Using the Rules view

The **Rules** tab is the default landing view.

### Create a rule
1. Click **New rule** (top-right of the rules table).
2. Fill in the form: name, the natural-language **Rule** text, trigger type, MCP servers (comma-separated), backend, sandbox, and the optional backstops.
3. Click **Create**.

The form validates the required fields client-side; the main process re-validates with Zod before saving (see [validation rules](../../rule-config-schema.md#11-validation-rules)). Invalid input shows an inline error.

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

These mirror [rule-config-schema §11](../../rule-config-schema.md#11-validation-rules):

1. `trigger` is required and must be a valid type (`tick` or `event`).
2. Tick: `intervalSeconds`, if set, must be ≥ **300** (5-minute floor — every tick is a full agent run).
3. Event: `eventType` is required and non-empty.
4. `mcpServers` is required and non-empty. Every name must exist in `mcp-servers.json` **and** hold no `<your-token-here>` placeholder.
5. `rule` must be non-empty.
6. `maxRuns`, if set, must be a positive integer (or `null` for unlimited).
7. `expiresAt`, if set, must be a valid ISO timestamp in the future.

Cross-file validation (mcpServers existing in the config file, placeholders filled) happens at **run time**, so a rule can be saved referencing a server you haven't configured yet — it just won't run until you do.

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

## Gotchas

- **No cross-run write deduplication.** Each run is a fresh session with no memory of prior writes. One-off rules are protected by the status contract (a `done` rule stops before re-creating), but **ongoing rules** (status stays `active`) may create duplicate tasks each cycle. De-duplicate manually in the task manager. See [design: known constraints §8](../../architecture.md#8-known-constraints--risks).
- **Auto-execute.** Writes happen immediately on the agent's decision — there is no pre-approval gate. Use [Observability](../observability/README.md) to review what happened, and keep blast radius small via `mcpServers` + `sandbox`.
- **Saving a rule ≠ it can run.** A rule referencing an undefined MCP server saves fine but fails at run time with a clear error. Use the [Sources](../mcp-sources/README.md) view to validate.

## Related
- [Triggers](../triggers/README.md) — how and when a rule fires.
- [MCP sources](../mcp-sources/README.md) — the `mcpServers` field in detail.
- [Stop conditions](../stop-conditions/README.md) — `maxRuns`, `expiresAt`, and the status contract.
- [design: rule-config-schema](../../rule-config-schema.md) — the authoritative schema.
