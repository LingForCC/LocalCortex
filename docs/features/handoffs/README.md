# Handoffs (agent-done → review subtask)

A **handoff** lets you register a reminder that fires when an agent session
completes. The typical flow: you hand a long-running ZCode / Codex / Claude
session off to work on a task manager item (an OmniFocus task, a Todoist task,
…), and when that session ends LocalCortex automatically runs a rule that
creates a **review subtask** under the original item — so you're reminded to
review the agent's work later without watching the session.

> Handoffs are **manager-agnostic** and **agent-source-agnostic**. LocalCortex
> is a dumb pipe: it stores an opaque session id + an opaque key-value
> `context` map, and forwards the context to the fulfilling rule. Adding a new
> task manager or agent source needs no code change — only rule text and (for a
> new agent source) a hook script.

> **Enable/disable, not fire-once.** A handoff has an `enabled` toggle, not a
> fulfilled/pending lifecycle. When enabled, it fires on **every** matching
> session-complete event — so a multi-round coding session (where the Stop hook
> fires once per round) creates the reminder each round. Disabling stops it from
> firing; there is no "fulfilled" state and no run-id tracking.

---

## Prompt-submit prompt

When a user submits a prompt, the source's `UserPromptSubmit` hook POSTs a
`<source>.prompt-submit` event (e.g. `zcode.prompt-submit`,
`codex.prompt-submit`). LocalCortex reacts by opening a **separate popup
window** that asks you what to do, depending on whether a handoff already exists
for that session:

> **The popup only opens for agents backed by an enabled handoff profile.** The
> event's `type` must equal the `promptSubmitEventType` of an agent that some
> **enabled** handoff profile references. A `prompt-submit` event from an agent
> with no enabled profile is silently ignored by the popup — it does **not**
> open. (The event still flows through the normal match/enqueue path, so any
> rule whose `eventType` matches it runs and is enriched as usual.) This keeps
> the popup tied to active handoff configurations rather than firing on every
> prompt-submit from every source. See
> [Handoff profiles](../handoff-profiles/README.md) for how profiles bind to
> agents.

- **New session** (no handoff row) → the popup offers the **attach form**:
  the session id is pre-filled, and you add context rows (`parentTaskId`,
  `parentTaskName`, …) plus an optional reminder title, then **Attach handoff**.
  This is the same form as the Handoffs panel, surfaced at the moment the
  session starts — no need to remember to register it mid-task.
- **Existing session** (a handoff row already exists) → the popup offers an
  **enable/disable toggle** so you can turn the handoff back on (or off) when
  you resume a session.

The popup is the primary use of a `prompt-submit` event, but it is **not the
only** one — a prompt-submit event is a normal event type and will also drive
any event-triggered rule that matches it, exactly like `session-complete`. See
"Prompt-submit events and rules" below for the interaction between the popup,
rule runs, and enrichment.

> **One popup per session.** If a popup is already open for a session and
> another `prompt-submit` arrives, LocalCortex re-focuses and refreshes it
> rather than opening a second window.

The start hooks are installed alongside the completion hooks (see §1 below).
Both backends are supported: the ZCode plugin registers `UserPromptSubmit`
automatically, and the standalone Codex bridge script
(`src/main/events/codex-prompt-submit-hook.sh`) is wired into a Codex hooks
config.

---

## The flow

1. **Register** a handoff (Handoffs panel): enter the agent **session id** and a
   set of **context** key-values (e.g. `parentTaskId=o2LOz5FWVIj`). The handoff
   starts **enabled**.
2. The agent runs; you continue with other work.
3. The session completes (or a round ends) → a source-specific **Stop hook**
   POSTs a `<source>.session-complete` event to the ingress with
   `payload.sessionId`.
4. LocalCortex **correlates** the session id to your handoff and, if it's
   enabled, **merges** its context into the event payload.
5. An event-triggered **rule** matches that event type, runs an agent with your
   task manager's MCP server, renders `{{parentTaskId}}` (etc.) into its prompt,
   and creates the review subtask.
6. The handoff stays enabled — the next round's Stop event fires it again. Toggle
   it off in the panel when you no longer want reminders for that session.

---

## 1. Install lifecycle hooks (once per agent source)

Each agent source needs a **Stop** hook (to notify LocalCortex when a session
ends) and, optionally, a **UserPromptSubmit** hook (to open the attach popup
when a user submits a prompt). The completion hook reads the source's
session-id env var and POSTs it to the loopback ingress; the start hook does
the same on prompt submit.

### ZCode

The ZCode hook system exposes `CLAUDE_SESSION_ID` to hook scripts. Register the
shipped bridge in your workspace `.zcode/config.json`:

```jsonc
{
  "hooks": {
    "enabled": true,
    "events": {
      "Stop": [
        {
          "hooks": [
            {
              "type": "command",
              "command": "bash \"${ZCODE_PROJECT_DIR}/src/main/events/zcode-hook.sh\"",
              "timeout": 10,
              "statusMessage": "Notifying LocalCortex"
            }
          ]
        }
      ],
      "UserPromptSubmit": [
        {
          "hooks": [
            {
              "type": "command",
              "command": "LC_EVENT_TYPE=zcode.prompt-submit bash \"${ZCODE_PROJECT_DIR}/src/main/events/zcode-hook.sh\"",
              "timeout": 10,
              "statusMessage": "Notifying LocalCortex"
            }
          ]
        }
      ]
    }
  }
}
```

The `Stop` entry fires a `zcode.session-complete` event; the `UserPromptSubmit`
entry reuses the **same script** with `LC_EVENT_TYPE=zcode.prompt-submit` to
fire a `zcode.prompt-submit` event (which opens the attach popup).

> **Note on `Stop`:** ZCode has no dedicated "session closed" event; `Stop`
> fires when an agent turn ends. Because a handoff fires on every match while
> enabled (not fire-once), each `Stop` for the session creates a new reminder —
> which is the intent for multi-round sessions. Disable the handoff when you no
> longer want reminders for that session.
>
> **Prefer the plugin.** Instead of editing `.zcode/config.json` per workspace,
> install the bundled **`localcortex-hook` plugin** (see
> `packaging/zcode-hook-plugin/`), which registers both the Stop and
> UserPromptSubmit hooks across every workspace in one step.

### Codex / Claude Code

The shipped `src/main/events/codex-hook.sh` fires `codex.session-complete` from
Codex's first-party hooks; wire it into your Codex hooks config. For the
prompt-submit popup, also wire `src/main/events/codex-prompt-submit-hook.sh`
into the Codex `UserPromptSubmit` hook — it reads the session id from Codex's stdin
JSON and POSTs a `codex.prompt-submit` event. Claude Code is analogous
(`CLAUDE_SESSION_ID`, `claude-code.session-complete` / `claude-code.prompt-submit`)
— and is wired up automatically: the shipped **`localcortex-hook` plugin**
(see `packaging/claude-hook-plugin/`) registers both hooks, and Claude Code is a
builtin coding agent (seeded by migration 008), so no custom catalog entry is
needed.

### Cursor / others

Add a new hook script mirroring `zcode-hook.sh` that reads whatever env var the
source exposes and POSTs a `cursor.session-complete` event. No LocalCortex code
change is needed — only the hook and a matching event-triggered rule.

---

## 2. Register a handoff (per task)

In the **Handoffs** panel:

- **Agent session id** — paste the in-flight session id (e.g.
  `sess_c286a04e-…` for ZCode). This is auto-captured by the completion hook;
  you paste it here once.
- **Context** — key-values that will be merged into the completion event and
  become `{{key}}` template variables in the fulfilling rule. Common keys:
  - `parentTaskId` — the task-manager id to nest under (e.g. OmniFocus
    `o2LOz5FWVIj`, the segment of `omnifocus:///task/o2LOz5FWVIj`).
  - `parentTaskName` — the parent task's name. Recommended as a second key for
    OmniFocus: the `omnifocus-mcp` server resolves by id first, then falls back
    to name, so registering both lets the rule retry by name if id-matching
    fails (see the sample rule below).
  - `taskManager` — `omnifocus`, `todoist`, … (informational; use it in rule
    filters or prompt text).
- **Reminder title** (optional) — a human label for the reminder.

You can register a handoff at any point while the session is still running.

---

## 3. Author a fulfilling rule (once per task manager)

Create an **event-triggered rule** matching the completion event type. The
rule's prompt renders the registered context variables. The rule differs per
task manager only in `mcpServers` + prompt text.

> **Tool names depend on your MCP server.** LocalCortex carries the parent id
> to the agent; *how* the agent creates the subtask (tool name + parameter
> names) is determined by whichever external OmniFocus/Todoist MCP server you
> installed. The examples below assume the popular
> [`omnifocus-mcp`](https://github.com/themotionmachine/OmniFocus-MCP) package
> (`add_omnifocus_task` with `parentTaskId`/`parentTaskName`). If you use a
> different server or fork, adjust the tool name and params to match.

### OmniFocus (external MCP server)

Configure your external OmniFocus MCP server in the **Sources tab** under the
name `omnifocus` (it's seeded by default — just point it at your server path),
then:

```jsonc
{
  "id": "r_review_omnifocus",
  "name": "Create review subtask on ZCode session complete",
  "enabled": true,
  "rule": "A ZCode session working on an OmniFocus task has just completed. Create a review subtask under the OmniFocus task whose id is {{parentTaskId}}. Call add_omnifocus_task with name 'Review agent work' and parentTaskId '{{parentTaskId}}'. If the tool reports the parent was not found, retry with parentTaskName '{{parentTaskName}}' instead. Emit status done once the subtask is created.",
  "trigger": { "type": "event", "eventType": "zcode.session-complete" },
  "mcpServers": ["omnifocus"],
  "backend": "codex",
  "sandbox": "read-only"
}
```

> **`parentTaskId` vs `parentTaskName`.** The `omnifocus-mcp` server resolves
> the parent by id first (`parentTaskId`), then falls back to name
> (`parentTaskName`). Id-matching is more accurate but can fail if the id
> doesn't exactly match OmniFocus's internal primary key (e.g. a typo, or the
> task lives in a non-front document). For robustness, register **both** in
> the handoff context and have the rule fall back from id to name — as the
> sample above does.
>
> The `parentTaskId` should be OmniFocus's internal task id (the segment of an
> `omnifocus:///task/<id>` URL, e.g. `o2LOz5FWVIj`). You can confirm an id by
> querying with the server's `query_omnifocus` tool.

### Todoist

```jsonc
{
  "id": "r_review_todoist",
  "name": "Create review task on ZCode session complete",
  "enabled": true,
  "rule": "A ZCode session has completed. Create a Todoist task titled 'Review agent work' under the parent task {{parentTaskId}} via the todoist tools. Emit status done once created.",
  "trigger": { "type": "event", "eventType": "zcode.session-complete" },
  "mcpServers": ["todoist"],
  "backend": "claude",
  "sandbox": "read-only"
}
```

> **Multiple managers:** if you run both an OmniFocus rule and a Todoist rule
> matching `zcode.session-complete`, both receive the same enriched context.
> In practice you register a handoff for a specific task in a specific manager,
> so only the relevant rule makes sense to write. Use the `taskManager` context
> key + a `trigger.filter` if you want a rule to match only one manager.

---

## How context flows (under the hood)

The prompt builder (`src/main/agent/prompt-builder.ts`) renders `{{var}}` from
the event payload. The handoff enrichment (`src/main/events/handoff-enrichment.ts`)
is the only place correlation happens: it looks up the handoff by
`payload.sessionId`, and if enabled, merges its `context` into the payload
before the run is enqueued. From there the existing template-render path carries
the variables into the rule's prompt — **no prompt-builder changes were needed**
to support handoffs.

### Prompt-submit events and rules

A `<source>.prompt-submit` event is a normal event type — it is **not**
popup-only. Two things happen, in order, for every accepted prompt-submit event
(see `src/main/events/ingress.ts`):

1. **Popup** (`onEvent` observer): `buildPromptSubmitPrompt` looks up any
   existing handoff for `payload.sessionId` (enabled **or** disabled — via
   `findBySessionId`, distinct from the completion-time `findEnabledBySessionId`)
   and opens the handoff-attach popup.
2. **Rules** (`onMatched`): any event-triggered rule whose `eventType` equals
   the prompt-submit type (e.g. `zcode.prompt-submit`) matches and runs, just
   like for `session-complete`. **Handoff enrichment applies to these runs too**
   — `prepareHandoffEnrichment` runs unconditionally inside `onMatched`, so if
   an enabled handoff exists for that `sessionId`, its context merges into the
   payload and the rule sees the `{{key}}` variables.

The practical catch: whether enrichment *adds anything* to a prompt-submit rule
run depends on whether a handoff already exists **at the moment the event
arrives** — a handoff created *from the popup during this same event* is created
after the run was already enqueued, so that first run won't see it. Enrichment
only kicks in on a *later* prompt submit where the handoff was already
registered and enabled.

| Event type | Popup? | Rules run? | Enrichment applies? |
| --- | --- | --- | --- |
| `*.prompt-submit` | Yes | Yes, if a rule matches it | Yes, if an enabled handoff pre-exists for that `sessionId` |
| `*.session-complete` | No | Yes, if a rule matches it | Yes, if an enabled handoff pre-exists for that `sessionId` |

So you *can* author rules on prompt-submit (e.g. "when a user submits a prompt,
log a start event" or "prep the workspace"), and they'll receive enriched
context on later submits — but the common case (the first prompt of a brand-new
session, where you attach the handoff from the popup) won't be enriched because
no handoff existed yet. For the canonical "create a review subtask" flow, keep
your rule on `*.session-complete`.
