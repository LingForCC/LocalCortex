# Triggers

A trigger decides **how and when** a rule fires. Every rule has exactly one trigger — it is either **tick** (scheduled polling) or **event** (reacts to a local HTTP event). The two are mutually exclusive.

> Design: [architecture §3.4 (two trigger models)](../../architecture.md#34-two-trigger-models-tick-and-event).

---

## Tick trigger — scheduled polling

```jsonc
"trigger": { "type": "tick", "intervalSeconds": 3600 }
```

The scheduler fires the rule every `intervalSeconds`. Each tick is a **full agent run**: the agent wakes, fetches source state via MCP, evaluates the rule, acts, and emits a status. There is no cheap "did anything change?" check — the agent _is_ the poller.

| Field | Meaning |
| --- | --- |
| `intervalSeconds` | Optional. Falls back to the [global default](../settings/README.md) when omitted. Must be ≥ **300** (5-minute floor). |

### Effective interval
```
rule.intervalSeconds  ??  settings.tickIntervalSeconds  ??  built-in default (3600)
```
clamped to ≥ 300. Lowering the interval raises token cost **linearly** with no steady-state savings — this is the primary cost control.

### What the scheduler does
- Maintains one timer per **enabled, tick-triggered** rule.
- After each tick, re-arms the next timer (so a slow run never overlaps the next tick).
- Swallows run-callback errors so a single failure doesn't stall the schedule.
- Re-schedules all rules when you edit, enable/disable, or change the global interval.

Tick rules are ignored by the event path entirely.

---

## Event trigger — react to local HTTP events

```jsonc
"trigger": {
  "type": "event",
  "eventType": "codex.session-complete",
  "filter": { "workdir": "/Users/colin/code/*" }   // optional glob filters
}
```

The rule fires the moment a matching event arrives at the app's **local HTTP ingress** (`127.0.0.1:4729/event`). No polling — the run is immediate.

| Field | Meaning |
| --- | --- |
| `eventType` | Required, non-empty. Matched against the event's `type` **exactly** (e.g. `codex.session-complete`, `zcode.prompt-submit`, `claude-code.session-complete`, `build.failed`). Open-ended — whatever a source POSTs. |
| `filter` | Optional. Glob filters on event-payload fields. v1 supports `*` / `?` globbing on string fields. |

> **`prompt-submit` events are normal event types.** A `<source>.prompt-submit`
> event type (e.g. `zcode.prompt-submit`, `codex.prompt-submit`, `claude-code.prompt-submit`) opens the
> handoff-attach popup via the ingress `onEvent` observer — but **only if an
> enabled handoff profile references that event's agent** — **and** can trigger
> rules just like any other event type; they are not popup-only. Rule matching
> is independent of the popup gate, so a rule can match a `prompt-submit` event
> even when no profile backs it (and the popup stays closed). See
> [Handoffs → Prompt-submit events and rules](../handoffs/README.md#prompt-submit-events-and-rules)
> for how enrichment interacts with prompt-submit rule runs.

### Matching
A rule matches an event when:
1. its `trigger.type === "event"`,
2. its `eventType` equals the event's `type`, **and**
3. **every** entry in its `filter` glob-matches the same-named payload field.

Multiple rules can match one event — each produces an **independent** agent run.

### The ingress
Any process running as the user can POST JSON to the loopback listener:

```bash
curl -s -X POST http://127.0.0.1:4729/event \
  -H "Content-Type: application/json" \
  -d '{
    "type": "codex.session-complete",
    "timestamp": "2026-07-07T14:23:00Z",
    "payload": {
      "source": "codex",
      "sessionId": "abc-123",
      "workdir": "/Users/colin/code/web-app",
      "summary": "Refactored auth module; 3 files changed"
    }
  }'
```
- Missing `type` or `timestamp` → **HTTP 400**.
- If a [shared secret](../settings/README.md) is configured, requests must carry `x-localcortex-secret: <secret>` or get **HTTP 401**.
- Every received event is logged.
- Response: `{ "ok": true, "matched": <n> }` — `matched` is how many rules fired.

### Bridging external systems
The app contains no system-specific monitoring code. External systems push events via hook scripts. LocalCortex ships bridges and documents the pattern:

- **Codex** — `src/main/events/codex-hook.sh` POSTs Codex's `session-complete` hook, and `src/main/events/codex-prompt-submit-hook.sh` POSTs a `prompt-submit` hook (for the attach popup). Install both into your Codex hooks config.
- **ZCode** — `src/main/events/zcode-hook.sh` serves both the Stop (`zcode.session-complete`) and UserPromptSubmit (`zcode.prompt-submit`) hooks via an `LC_EVENT_TYPE` env override, or install the bundled `localcortex-hook` plugin (`packaging/zcode-hook-plugin/`) which registers both declaratively.
- **Claude Code** — an equivalent shell hook POSTs on session/stop events.
- **Arbitrary** — any script (`make`, CI, a `git` post-commit hook) can `curl` the endpoint.

Set `LC_PORT`, `LC_HOST`, and `LC_SECRET` env vars to point the hook at a non-default ingress or authenticate.

---

## Template variables (event rules only)

Event-triggered rule text may contain `{{variable}}` placeholders. At run time the prompt builder renders them from the event's `payload`:

```
"A Codex session just completed in {{workdir}} with summary: {{summary}}."
```
becomes
```
"A Codex session just completed in /Users/colin/code/web-app with summary: Refactored auth."
```

| Behavior | Detail |
| --- | --- |
| Available variables | Whatever the source PUTs in `payload` — open-ended. A `codex.session-complete` event typically carries `workdir`, `summary`, `sessionId`, `timestamp`. |
| Nested lookup | `{{a.b.c}}` walks dotted paths into nested objects. |
| Missing / null / object | Renders **empty string** (never `[object Object]`). |
| Number / boolean | Stringified. |
| Tick rules | Have no payload — don't use templates (they'd render empty). |

---

## Choosing tick vs event

| Use case | Trigger | Why |
| --- | --- | --- |
| Poll an external item until a condition is met (MR merges, PR goes stale) | **tick** | You must re-check on a cadence; the source doesn't notify you. |
| React when something happens locally (Codex session done, build fails) | **event** | Cheaper, immediate — no point polling when the source can push. |
| One-off reminder | tick (small `maxRuns`) or event (`maxRuns: 1`) | See [Stop conditions](../stop-conditions/README.md). |

---

## Gotchas

- **Tick cost is linear.** Each tick is a full agent run, even when nothing changed. Default cadence is conservative (60 min) on purpose.
- **Event ingress is loopback-only but not authenticated by default.** Any process as the user can POST events and trigger runs (which under auto-execute means writes). Mitigate with the [shared-secret setting](../settings/README.md). Blast radius is bounded by each rule's `mcpServers`.
- **Filter mismatches on non-strings.** A glob filter only matches string payload values. An object/array/missing field never matches → the rule doesn't fire.
- **`workdir` vs `{{workdir}}`.** The agent's _run_ workdir is set at config time (the `workdir` field), not rendered from the event. To run the agent _in_ the session's directory, set `workdir` explicitly, or let the agent read files by absolute path from the rendered `{{workdir}}`.

## Related
- [Rules](../rules/README.md) — the trigger field is part of a rule.
- [MCP sources](../mcp-sources/README.md) — what the agent calls during the run.
- [Settings](../settings/README.md) — global tick default, concurrency, ingress secret, CLI paths.
- [design: §6.7 event ingress](../../architecture.md#67-event-ingress--local-http-listener), [§6.5 cadence](../../architecture.md#65-cadence--global-default--per-rule-override).
