# Observability (Run History)

Every agent run is recorded in full: the assembled prompt, every tool call, the token cost, the duration, the agent's final text, and the parsed status block. Because LocalCortex **auto-executes** (no pre-write approval gate), observability is the safety net — you review what happened, post-hoc.

> Design: [architecture §4 (observability)](../../architecture.md#4-module-layout), [§6.3 auto-execute](../../architecture.md#63-safety--auto-execute).

---

## What gets recorded

Each row in the `runs` table captures one run end-to-end:

| Field | Meaning |
| --- | --- |
| `id` | Auto-increment run id. |
| `ruleId` / `trigger` | Which rule ran and how it was fired (`tick` / `event` / `manual`). |
| `startedAt` / `endedAt` | ISO timestamps; `durationMs` derived. |
| `status` | `success` or `error`. |
| `prompt` | The **fully-assembled** prompt sent to the agent (rendered rule + status contract + tool list). |
| `toolCalls[]` | Each tool call observed: name, args, result (best-effort capture). |
| `inputTokens` / `outputTokens` | Token usage, if the SDK reports it. |
| `result` | The agent's final text response. |
| `parsedStatus` | The `{status, reason}` block parsed from the result (see [Stop conditions](../stop-conditions/README.md)). |
| `error` | Short error message when the run errored. |
| `eventPayload` | JSON of the event that triggered the run (event-triggered only). |

Runs cascade-delete with their rule, so deleting a rule removes its history too.

---

## Using the Run history view

The **Run history** tab shows a table of recent runs, newest first:

| Column | Meaning |
| --- | --- |
| `#` | run id |
| `Rule` | rule id (mono) |
| `Trigger` | tick / event / manual |
| `Status` | success (green) / error (red) badge |
| `Parsed` | the agent's emitted status: active / done / error |
| `Tokens (in/out)` | usage counters |
| `Duration` | wall-clock ms |
| `Started` | ISO timestamp |

### Inspecting a run
Click any row to open a detail panel with three sections:

- **Prompt** — exactly what was sent to the agent. Useful for debugging template rendering or verifying the status contract was included.
- **Result** — the agent's final text (or the error message if it failed).
- **Tool calls** — the JSON array of every tool invocation the agent made, with args and results. This is where you see _what the agent actually did_ — which MCP server it called, with what arguments, and what came back.

---

## Why this matters

Under auto-execute, the agent's decisions land in your task manager (or repo, for `workspace-write` rules) **immediately**. There is no "review before applying" step. Observability fills that gap from the other direction:

- **Mistakes are visible.** If a rule created a wrong task, the run record shows exactly which tool call made it and with what args — so you can correct in the task manager and refine the rule.
- **Cost is accountable.** Token counts per run make it obvious when a rule is expensive (e.g. a too-short tick interval).
- **Status is auditable.** The parsed status tells you _why_ a rule stopped (or didn't).

> **Limitation:** there is no **cross-run write deduplication**. Observability shows you each run independently; it does not correlate "the agent already created a task for this item last cycle." See [design: known constraints §8](../../architecture.md#8-known-constraints--risks).

---

## Logging (main process)

In addition to the `runs` table, the main process writes structured, rotating logs via `electron-log` to `~/Library/Logs/LocalCortex/` on macOS. Each run logs a one-line summary (id, rule, trigger, status, tokens, ms, parsed status). The event ingress logs every received event. Renderer errors/warnings are forwarded to the main log too. These logs are the first place to look when a run misbehaves and the DB record isn't enough.

---

## Gotchas
- **Best-effort tool-call capture.** Tool calls are parsed from the agent's transcript/items as best the runner can. Format quirks in either SDK could drop or mislabel a call; the `result` text is the ground truth.
- **Tokens may be absent** if an SDK version doesn't report usage for a given run — they show as `?` in the UI.
- **History is per-machine.** Runs live in the local SQLite DB; they aren't synced.

## Related
- [Stop conditions](../stop-conditions/README.md) — the parsed status drives rule disabling.
- [Rules](../rules/README.md) — Run-now and the run counter.
- [design: §7 per-run flow](../../architecture.md#7-per-run-flow-end-to-end).
