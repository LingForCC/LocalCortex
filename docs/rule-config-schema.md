# Rule Configuration Schema

This document specifies the user-facing rule configuration format for LocalCortex. A rule is a natural-language instruction plus the minimal structure needed to run it: how it fires (tick or event), which MCP servers to attach, which agent backend to use, and a few execution settings.

The schema is the contract between the renderer (rule editor UI) and the main process (scheduler, event ingress, `AgentRunner`). It is stored in the `rules` table of the app's SQLite database (see [architecture.md §4](./architecture.md#4-module-layout)).

All decisions referenced here are recorded in [architecture.md](./architecture.md).

---

## 1. Top-level shape

```jsonc
{
  "id": "r_codex_session_followup",
  "name": "Review completed Codex sessions",
  "enabled": true,

  "rule": "<natural-language instruction>",         // §2
  "trigger": { ... },                              // §3 — how the rule fires

  "mcpServers": ["todoist"],                       // §4 — which servers to attach

  "backend": "claude",                             // §5 — claude | codex
  "workdir": "/Users/colin/code/my-repo",          // §6 — agent working directory
  "sandbox": "read-only",                          // §6 — read-only | workspace-write

  "maxRuns": 48,                                   // §7 — optional backstop
  "expiresAt": "2026-07-14T00:00:00Z",             // §7 — optional backstop
  "notes": "Optional human notes about this rule"
}
```

**Required fields:** `id`, `name`, `rule`, `trigger`, `mcpServers`, `backend`.

**Optional fields** (with defaults): `enabled` (true), `workdir` (per-rule scratch dir), `sandbox` (read-only), `maxRuns` (global default, e.g. 48), `expiresAt` (none), `notes`.

### Design principle: the rule is the spec

Everything about *what* the agent should do — which source to query, which item to look at, what condition to check, where to write, what the task should say — lives in the `rule` text as natural language. The only structured fields are the ones the app genuinely needs to run the agent: how it fires, which MCP servers to spawn, which backend, where to run. See [architecture.md §3.3](./architecture.md#33-scope-is-natural-language-not-structured).

---

## 2. `rule` — natural-language instruction

A free-text string that fully describes what the agent should do when the rule fires. This is the heart of the rule engine.

```jsonc
// Tick-triggered example
"rule": "Fetch the status of merge request !23494 from GitLab. If it has been completed (merged), create a Todoist task under the 'Engineering' project titled 'Merge MR !23494'."

// Event-triggered example (template variables rendered from the event payload)
"rule": "A Codex coding session just completed in {{workdir}} with summary: {{summary}}. Read the changed files, determine what action (if any) is required from me, and create an OmniFocus task under 'Code Review' describing it. If no action is needed, do nothing."
```

The rule text is responsible for:

- **What to look at** — which source, which item(s), which scope ("MR !23494", "open PRs assigned to me in acme/web-app", "the files changed in this session").
- **What condition to check** — the rule's predicate ("merged", "in review >24h without approval", "action required from me").
- **What to do** — the action and its specifics ("create a Todoist task under Engineering titled …", "create an OmniFocus task under Code Review").

### Template variables (event-triggered rules only)

For **event-triggered** rules, the rule text may contain `{{variable}}` placeholders. At run time, the prompt builder renders these from the incoming event's payload before assembling the prompt. For example, a `codex.session-complete` event carries `{ workdir, summary, sessionId, timestamp }`, so `{{workdir}}` and `{{summary}}` become concrete values in the prompt.

The available variables depend on the event source — whatever fields the external system POSTs to the ingress (see [architecture.md §6.7](./architecture.md#67-event-ingress--local-http-listener)) are available as templates. Unknown variables render empty. Tick-triggered rules have no payload and should not use template variables.

### Prompt contract (assembled by the app, not user-authored)

At run time the prompt builder wraps the user's `rule` (with templates rendered, for events) with one thing the user does *not* write:

- **The status contract** — a required machine-readable status block the agent must emit at the end of its final message:
  > *"At the end of your response, emit a JSON block on its own line: `{\"status\":\"<active|done|error>\",\"reason\":\"<short explanation>\"}`. Use `active` if the rule's goal is not yet met, `done` if it has been achieved or is no longer relevant, and `error` if you could not complete the task."*

  The app parses this block to decide whether to keep the rule active. See [§7](./rule-config-schema.md#7-stop-conditions--maxruns--expiresat) and [architecture.md §6.6](./architecture.md#66-stop-conditions--agent-signaled-completion--structural-backstop).

- **The available MCP tools** — the list of servers attached (from `mcpServers`), so the agent knows what it can call.

Users write only the natural-language part. Both contract elements are appended by the app.

> **⚠️ Known limitation — no cross-run write deduplication.** Because each agent run is a fresh session with no memory of prior runs, and the app does **not** track which writes have already been performed, the agent has no way to know it already created a task on a previous cycle. The status contract stops a rule after its goal is met (so *one-off* rules generally create each task exactly once), but for **ongoing rules** (status stays `active` indefinitely), or if status parsing ever fails, **the agent may create duplicate tasks on each run**. Users should expect to de-duplicate manually in the task manager. See [architecture.md §8](./architecture.md#8-known-constraints--risks). If this proves painful in practice, an idempotency mechanism can be added without re-architecting — see [§11](./rule-config-schema.md#11-open-questions-for-future-iterations).

---

## 3. `trigger` — how the rule fires

```jsonc
"trigger": { "type": "tick", "intervalSeconds": 3600 }
// or
"trigger": { "type": "event", "eventType": "codex.session-complete" }
```

A rule fires in one of two ways. The two trigger types are mutually exclusive — a rule is either tick-triggered or event-triggered, not both. See [architecture.md §3.4](./architecture.md#34-two-trigger-models-tick-and-event).

### 3.1 Tick trigger

```jsonc
"trigger": {
  "type": "tick",
  "intervalSeconds": 3600          // optional; falls back to global default (60 min)
}
```

The scheduler fires the rule on `intervalSeconds`. Because every tick is a full agent run, the interval is the primary cost control — lowering it raises token cost linearly with no steady-state savings. See [architecture.md §6.5](./architecture.md#65-cadence--global-default--per-rule-override).

### 3.2 Event trigger

```jsonc
"trigger": {
  "type": "event",
  "eventType": "codex.session-complete",     // the event type to match
  "filter": {                                 // optional — field filters
    "workdir": "/Users/colin/code/*"          //   e.g. glob on workdir
  }
}
```

The rule fires when an event with matching `type` arrives at the app's local event ingress (see [architecture.md §6.7](./architecture.md#67-event-ingress--local-http-listener)). The event's payload is rendered into the rule text as template variables (see [§2](./rule-config-schema.md#2-rule--natural-language-instruction)).

- **`eventType`** must match the event's `type` field exactly (e.g., `codex.session-complete`, `claude.session-complete`, `build.failed`). Event types are open-ended — whatever an external system POSTs.
- **`filter`** (optional) matches against event payload fields. v1 supports simple glob matching on string fields (e.g., `"workdir": "/Users/colin/code/*"` matches sessions in that tree). Multiple rules can match one event; each produces an independent agent run.

Event-triggered rules are the natural fit for "react when X happens" use cases — Codex session completion, build failures, file appearances — where polling would be wasteful or too slow.

---

## 4. `mcpServers` — which MCP servers to attach

```jsonc
"mcpServers": ["gitlab", "todoist"]
```

**Required.** The set of MCP servers spawned for this rule's runs, referenced by **name** as defined in the user's `~/.localcortex/mcp-servers.json`.

This is the *only* structural selector in the rule, and it exists for a specific reason: **agent tool-selection quality.** Function-calling models degrade as the tool list grows — if a user has configured six servers (two GitHub accounts, GitLab, Jira, Todoist, OmniFocus), spawning all of them every run means the agent sees 60–120 tools and starts calling the wrong server or hallucinating tool names. Curating the toolset per rule keeps the agent accurate. It also bounds the credential blast radius — a rule can only touch the systems its servers connect to.

Each name must exist as a key in `mcp-servers.json`. The same name can be used by multiple rules; users can also define multiple entries for the same upstream (e.g., `"github-personal"` and `"github-work"` pointing at different tokens) and pick per rule.

The default config file ships with three entries — `github`, `gitlab`, `todoist` — but users can add or rename freely. See [mcp-servers.md](./mcp-servers.md) for the file format, the default config, and the resolution algorithm.

All servers are external stdio servers, spawned per run — see [architecture.md §5.2, §5.4](./architecture.md#52-write-hosting--external-stdio-servers-uniformly).

---

## 5. `backend` — which agent runs the rule

```jsonc
"backend": "claude"        // claude | codex
```

Both backends are first-class — every rule declares which one runs it. See [architecture.md §3.1, §5.5](./architecture.md#31-agent-as-rule-engine--mcp-everywhere).

The `AgentRunner` interface abstracts the difference:

- **`claude`** — uses `options.cwd` for the workdir and `options.mcpServers` for in-call MCP config.
- **`codex`** — uses `startThread`'s `workingDirectory` for the workdir and the SDK's `options.config` for in-call MCP config (serialized into `--config key=value` flags).

---

## 6. `workdir` and `sandbox`

### `workdir`

The directory the agent's session runs from — see [architecture.md §6.1](./architecture.md#61-working-directory--first-class-rule-field).

```jsonc
"workdir": "/Users/colin/code/my-repo"
```

- **Claude** — passed as `options.cwd`.
- **Codex** — passed as `startThread`'s `workingDirectory`. MCP config is delivered per-call (§5.5), so the workdir holds no config file and `rule.workdir` is honored directly.

If omitted, defaults to a per-rule scratch directory. For event-triggered rules where the event carries a `workdir` field, the user may also choose to use `{{workdir}}` dynamically — but note the agent's `workdir` (where it runs) is set at config time, not rendered from the event. If you want the agent to run *in* the session's directory, set `workdir` to that path explicitly per rule, or accept the default scratch dir and let the agent read files by absolute path from the event payload.

### `sandbox`

Blast-radius control — see [architecture.md §6.2](./architecture.md#62-sandbox--tied-to-rule-intent).

```jsonc
"sandbox": "read-only"     // read-only | workspace-write
```

- **`read-only`** (default) — agent can read files in `workdir` but not modify them. Enforced via Claude `allowedTools` whitelist or Codex `--sandbox read-only`.
- **`workspace-write`** — agent can read/write within `workdir`. Use for rules that draft changes for review. Enforced via Codex `--sandbox workspace-write` or Claude's permissive tool set.

Note: writes to task managers happen via MCP servers and are governed by which servers are in `mcpServers` — `sandbox` controls filesystem blast radius only.

---

## 7. Stop conditions — `maxRuns`, `expiresAt`

```jsonc
"maxRuns": 48,                              // optional; defaults to global (e.g. 48)
"expiresAt": "2026-07-14T00:00:00Z"         // optional; ISO timestamp, no default
```

Without a stop condition, a tick-triggered rule runs forever. LocalCortex stops a rule via two complementary mechanisms. See [architecture.md §6.6](./architecture.md#66-stop-conditions--agent-signaled-completion--structural-backstop) for full detail.

### Agent-signaled completion (primary)

The agent emits a status block at the end of each run (see the prompt contract in [§2](./rule-config-schema.md#2-rule--natural-language-instruction)):

```json
{"status": "done", "reason": "MR !23494 was merged; reminder task created."}
```

- `active` — goal not yet met; keep firing.
- `done` — goal achieved or no longer relevant; the app disables the rule and logs the reason (tick rules only).
- `error` — could not complete (auth failure, item not found); the app disables the rule and surfaces the error (tick rules only).

This is the primary mechanism because only the agent understands the rule's intent (it's natural language, not structured).

> **Event-triggered rules are an exception:** they run as long as they are enabled — the agent's `done`/`error` status does **not** disable them, because each matching event is a discrete reaction and the rule should keep reacting to future events. Only a manual toggle, an explicit `maxRuns`, or an explicit `expiresAt` can auto-disable an event rule. The status is still parsed and recorded on each run for observability.

### Structural backstops (optional)

- **`maxRuns`** — when the run count reaches this limit, the rule is disabled with a "max runs reached" note. Defaults to a global value (e.g., 48 ≈ 2 days at 60-min cadence) so no **tick** rule is truly unbounded; set to `null` to allow unlimited runs. Event-triggered rules ignore this default cap (they run indefinitely unless an explicit `maxRuns` is set); an explicit `maxRuns` still applies, e.g. a true one-shot with `maxRuns: 1`.
- **`expiresAt`** — an ISO timestamp after which the rule is disabled. No default. Applies to all rules, including event-triggered ones.

If both are set, whichever triggers first disables the rule. These catch the case where the agent never signals `done` (e.g., a stalled MR that never merges) or where the status block fails to parse.

> **Note for event-triggered rules:** `expiresAt` applies to event-triggered rules as usual. `maxRuns` applies only when set explicitly — the default cap is suppressed, so an event rule with no `maxRuns` reacts to every matching event indefinitely (a standing watch). An explicit `maxRuns: 1` makes it a true one-shot that disables after the first matching event.

### Re-enabling

A rule disabled by any mechanism can be re-enabled manually in the UI. Re-enabling resets the run counter (fresh start) and clears the disable reason, which is preserved in run history.

---

## 8. Full example — tick-triggered

```jsonc
{
  "id": "r_gitlab_mr_reminder",
  "name": "Remind me to merge completed MRs",
  "enabled": true,

  "rule": "Fetch the status of merge request !23494 from GitLab. If it has been completed (merged), create a Todoist task under the 'Engineering' project titled 'Merge MR !23494'.",

  "trigger": { "type": "tick", "intervalSeconds": 3600 },

  "mcpServers": ["gitlab", "todoist"],

  "backend": "claude",
  "workdir": "/Users/colin/code/web-app",
  "sandbox": "read-only",

  "maxRuns": 48,
  "expiresAt": "2026-07-14T00:00:00Z",

  "notes": "Created 2026-07-07. One-off MR watch; disable after merge."
}
```

---

## 9. Full example — event-triggered

```jsonc
{
  "id": "r_codex_session_followup",
  "name": "Review completed Codex sessions",
  "enabled": true,

  "rule": "A Codex coding session just completed in {{workdir}} with summary: {{summary}}. Read the changed files, determine what action (if any) is required from me, and create an OmniFocus task under 'Code Review' describing it. If no action is needed, do nothing.",

  "trigger": {
    "type": "event",
    "eventType": "codex.session-complete",
    "filter": { "workdir": "/Users/colin/code/*" }
  },

  "mcpServers": ["todoist"],

  "backend": "claude",
  "workdir": "/Users/colin/code/web-app",
  "sandbox": "read-only",

  "maxRuns": null,                  // react to every matching session, indefinitely

  "notes": "Standing watch. Requires the Codex hook script installed."
}
```

---

## 10. TypeScript types

```ts
// src/main/db/schema.ts (or src/shared/types.ts)

export type AgentBackend = "claude" | "codex";
export type SandboxMode = "read-only" | "workspace-write";
export type TriggerType = "tick" | "event";
/**
 * A server name as defined in ~/.localcortex/mcp-servers.json.
 * Open-ended (any string the user defined) — see mcp-servers.md.
 */
export type McpServerName = string;

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;

  rule: string;                        // natural-language instruction — §2

  trigger: Trigger;                    // how the rule fires — §3

  mcpServers: McpServerName[];         // required — curates the agent's toolset — §4

  backend: AgentBackend;               // §5
  workdir?: string;                    // defaults to per-rule scratch dir — §6
  sandbox: SandboxMode;                // default "read-only" — §6

  maxRuns?: number | null;             // defaults to global; null = unlimited — §7
  expiresAt?: string;                  // ISO timestamp; no default — §7

  notes?: string;
}

export type Trigger = TickTrigger | EventTrigger;

export interface TickTrigger {
  type: "tick";
  intervalSeconds?: number;            // falls back to global default
}

export interface EventTrigger {
  type: "event";
  eventType: string;                   // e.g. "codex.session-complete"
  filter?: Record<string, string>;     // optional glob filters on event payload fields
}
```

---

## 11. Validation rules

Enforced by the app before a rule is saved or run:

1. `trigger` is **required** and must have a valid `type` (`tick` or `event`).
2. For `trigger.type === "tick"`: `intervalSeconds`, if set, must be ≥ 300 (5 minute floor — every tick is a full agent run).
3. For `trigger.type === "event"`: `eventType` is required and must be a non-empty string.
4. `mcpServers` is **required** and must be non-empty. Every name in it must exist as a key in `~/.localcortex/mcp-servers.json`, and none may still hold a `<your-token-here>` placeholder token.
5. `rule` must be non-empty.
6. `sandbox === "workspace-write"` should prompt the user to confirm (filesystem write access to `workdir`).
7. `maxRuns`, if set, must be a positive integer (or explicitly `null` for unlimited).
8. `expiresAt`, if set, must be a valid ISO timestamp in the future.

---

## 12. Open questions for future iterations

These don't block v1 but may shape later versions:

- **Cross-run write deduplication:** v1 does **not** track which writes a rule has already performed across runs. One-off rules are largely protected by the status contract, but ongoing rules may create duplicate tasks on each run. If this proves painful, an idempotency mechanism can be added — likely a key written into each task's note field at creation and a `find_by_key` content search the agent runs before creating (see [architecture.md §8](./architecture.md#8-known-constraints--risks)). This is additive — it slots into the prompt contract and the write MCP servers without re-architecting the rule schema.
- **Event payload schema validation:** event types are currently free-form strings with arbitrary payloads. A registry of known event types (with their expected fields) would help the rule editor offer template-variable autocomplete and validate filters.
- **Combined tick + event triggers:** a rule that polls on an interval but also reacts immediately to an event. Currently one-or-the-other; combining would require two firing paths per rule.
- **Rule templates:** Should commonly-used rule shapes (e.g., "react to a completed Codex session") be offered as templates in the UI?
- **Manual trigger:** Can the user run a rule ad-hoc with a synthetic event payload (e.g., "run this event rule as if a Codex session just completed with this summary")?
- **Dry-run mode:** A per-rule `dryRun: boolean` that instructs the agent to propose rather than execute, logged for review. Not in v1 (auto-execute was chosen) but the schema has room for it.
