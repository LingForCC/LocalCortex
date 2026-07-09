# Handoffs (agent-done → review subtask)

A **handoff** lets you register a reminder that fires when an in-flight agent
session completes. The typical flow: you hand a long-running ZCode / Codex /
Claude session off to work on a task manager item (an OmniFocus task, a Todoist
task, …), and when that session ends LocalCortex automatically runs a rule that
creates a **review subtask** under the original item — so you're reminded to
review the agent's work later without watching the session.

> Handoffs are **manager-agnostic** and **agent-source-agnostic**. LocalCortex
> is a dumb pipe: it stores an opaque session id + an opaque key-value
> `context` map, and forwards the context to the fulfilling rule. Adding a new
> task manager or agent source needs no code change — only rule text and (for a
> new agent source) a hook script.

---

## The flow

1. **Register** a handoff (Handoffs panel): enter the agent **session id** and a
   set of **context** key-values (e.g. `parentTaskId=o2LOz5FWVIj`).
2. The agent runs; you continue with other work.
3. The session completes → a source-specific **Stop hook** POSTs a
   `<source>.session-complete` event to the ingress with `payload.sessionId`.
4. LocalCortex **correlates** the session id to your handoff and **merges** its
   context into the event payload.
5. An event-triggered **rule** matches that event type, runs an agent with your
   task manager's MCP server, renders `{{parentTaskId}}` (etc.) into its prompt,
   and creates the review subtask.
6. LocalCortex **marks the handoff fulfilled** (recording the run id) so it
   won't fire again — even if the Stop hook fires repeatedly.

---

## 1. Install a completion hook (once per agent source)

Each agent source needs a Stop hook that notifies LocalCortex when a session
ends. The hook reads the source's session-id env var and POSTs it to the
loopback ingress.

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
      ]
    }
  }
}
```

This fires a `zcode.session-complete` event.

> **Note on `Stop`:** ZCode has no dedicated "session closed" event; `Stop`
> fires when an agent turn ends. The handoff correlation is idempotent (only
> `pending` handoffs match, and they're marked `fulfilled` after one run), so a
> repeated `Stop` for the same session enriches at most once.

### Codex / Claude Code

The shipped `src/main/events/codex-hook.sh` already fires
`codex.session-complete` from Codex's first-party hooks. Wire it into your
Codex hooks config. Claude Code is analogous (`CLAUDE_SESSION_ID`,
`claude.session-complete`).

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

Configure your external OmniFocus MCP server in `~/.localcortex/mcp-servers.json`
under the name `omnifocus`, then:

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
`payload.sessionId`, and if `pending`, merges its `context` into the payload
before the run is enqueued. From there the existing template-render path carries
the variables into the rule's prompt — **no prompt-builder changes were needed**
to support handoffs.
