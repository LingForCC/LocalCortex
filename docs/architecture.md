# Architecture

LocalCortex is a local-first Electron + TypeScript application that runs user-defined rules on a schedule to detect updates from external systems (GitHub, GitLab) and route them to a task manager (OmniFocus, Todoist). Rules are authored in natural language and executed by Codex or Claude Code, which reach external systems through MCP servers.

This document is the authoritative reference for the architectural decisions made during design. The companion [Rule Configuration Schema](./rule-config-schema.md) specifies the user-facing config format.

---

## 1. Product summary

A desktop app that:

- **Ticks** on a schedule and **wakes an agent** (Codex or Claude Code) each cycle — for poll-driven rules.
- **Receives local events** (e.g., a Codex session completing) and **wakes an agent** in response — for event-driven rules.
- The agent **fetches source state via MCP** (issues, PRs, merge requests) and **evaluates the user's natural-language rule** against what it finds.
- The agent **acts** on the task manager (create/update tasks) via MCP.
- Lets the user define rules in **natural language** and choose **how** updates are injected (which task manager, which project).
- **Stops a rule** when its goal is met (agent-signaled) or when a run/time limit is hit — so one-off rules don't run forever.
- Can also perform **ad-hoc agent actions** in external systems on demand.

The app is a scheduler, an event listener, a prompt manager, and an MCP-server orchestrator. It owns almost no integration code — the agents and the MCP servers do the integration work.

---

## 2. Tech stack

| Concern | Choice | Rationale |
|---|---|---|
| Runtime | **Electron 35+ + TypeScript** | Both agents ship first-party TS SDKs; Electron 35+ bundles Node 22.14, enabling `node:sqlite`. Renderer never touches Node/CLIs/filesystem. |
| Build / packaging | **Electron Forge + Vite template** | Official; handles `.dmg`, code signing, notarization, auto-update. Vite gives fast HMR. |
| Agent SDKs | `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk` (main process) | First-party, typed events, native async iteration. |
| Renderer UI | **React 19 + Tailwind 4 + shadcn/ui** | Forms + tables + log viewers — shadcn's sweet spot. |
| Renderer state | **Zustand** | Light app-level state; IPC is the data layer (no React Query needed). |
| Database | **`node:sqlite`** (Node built-in) | Zero native-module pain — no rebuild, no ASAR unpacking, no `drizzle-kit` ABI mismatch. Schema is small (2 tables); raw SQL + Zod row validation replaces an ORM. |
| Validation | **Zod** | Parse rule config, event payloads, IPC messages, DB rows. |
| Event ingress | **Fastify** | Local HTTP listener on `127.0.0.1`; Zod-compatible request validation. |
| Logging | **electron-log** | Main-process file logging with rotation; observability is the safety net under auto-execute. |
| Unit tests | **Vitest** | Vite-native, fast; for pure-logic modules (scheduler, matcher, prompt builder). |
| E2E tests | **Playwright (`@playwright/test`)** | Electron-aware; drives the real app, evaluates main-process code. |
| Lint / format | **ESLint + Prettier** | Standard. |
| Distribution | **Developer ID + notarize, outside Mac App Store** | Subprocess/CLI/secret access rules out the App Store sandbox. |

Full rationale, dependency map, and known gotchas are in [tech-stack.md](./tech-stack.md).

**Trade-off accepted:** OmniFocus integration is weaker than a native Swift app would offer (must shell out to JXA/AppleScript rather than in-process automation). Mitigated by a custom thin JXA wrapper (§5).

---

## 3. Core architecture

### 3.1 Agent-as-rule-engine + MCP-everywhere

Instead of a custom rules engine, the agent (Codex/Claude) **is** the rule engine and orchestrator. Every external system is reached through an existing MCP server:

- **Sources** (read): GitHub → official `github-mcp-server`; GitLab → official GitLab Duo MCP or community `yoda-digital/mcp-gitlab-server`.
- **Sinks** (write): Todoist → official MCP server; OmniFocus → custom thin JXA wrapper (§5).

Build scope collapses to: scheduler + prompt manager + MCP-server orchestrator. Almost no integration code.

### 3.2 Agent-driven polling

Every scheduled tick spins up the agent. The agent fetches the current source state via MCP, evaluates the natural-language rule, and acts on the sink via MCP. There is no separate deterministic poller; the agent is the only thing that reads source state.

```
┌──────────┐  every N min  ┌──────────────────────────────┐
│ Scheduler│──────────────▶│ Agent run (LLM)              │
└──────────┘               │  ├─ MCP: fetch source state  │
                           │  ├─ evaluate rule (NL)       │
                           │  └─ MCP: write to sink       │
                           │     (idempotent via keys)    │
                           └──────────────────────────────┘
```

- **Steady state still costs a full agent run per cycle** (model tokens + several MCP round-trips), even when nothing changed. This is the core trade-off of this design — accepted for architectural simplicity.
- **Idempotency keys** prevent duplicate writes across cycles: each created task carries a stable key (`source:<system>:<id>`); the agent searches for an existing task by key before creating.
- **Recommended cadence is conservative** (default 60 min) to bound token cost. Frequent polling multiplies cost linearly with no steady-state savings.

### 3.3 Scope is natural language, not structured

Everything about *what* the agent should do — which source to query, which item to look at, what condition to check, where to write, what the task should say — lives in the rule text as natural language. There are no structured `source` or `sink` objects. A user writes:

> "Fetch the status of merge request !23494 from GitLab. If it has been merged, create a Todoist task under the 'Engineering' project titled 'Merge MR !23494'."

The only structural selector is **`mcpServers`** — which MCP servers to attach to the run. This exists not to duplicate the rule's intent, but to **curate the agent's toolset**: function-calling models degrade as the tool list grows, so a user with six configured servers (two GitHub accounts, GitLab, Jira, Todoist, OmniFocus) must narrow the toolset per rule or the agent starts calling the wrong server or hallucinating tools. `mcpServers` is required and also bounds credential blast radius — a rule can only touch the systems its servers connect to. See [rule-config-schema.md §3](./rule-config-schema.md#3-mcpservers--which-mcp-servers-to-attach).

**Stopping a rule** when its goal is met is handled in the **prompt contract**: the app appends a status contract requiring the agent to emit `{"status":"active|done|error"}` each run, and the app disables the rule on `done`/`error`. See [rule-config-schema.md §2, §7](./rule-config-schema.md#2-rule--natural-language-instruction) and [§6.6](./architecture.md#66-stop-conditions--agent-signaled-completion--structural-backstop).

**Note: no cross-run write deduplication.** Each agent run is a fresh session with no memory of prior writes, and the app does not track which writes a rule has already performed. The status contract protects one-off rules (a `done` rule stops running before it can re-create), but **ongoing rules (status stays `active`) may create duplicate tasks on each cycle.** This is a known limitation — see [§8](./architecture.md#8-known-constraints--risks).

### 3.4 Two trigger models: tick and event

A rule fires in one of two ways, declared by its `trigger` field:

- **Tick trigger** (§3.2) — the scheduler fires the rule on `tickIntervalSeconds`. The agent fetches state and evaluates the rule. This is the polling model described above.
- **Event trigger** (new) — the rule fires when a matching event arrives at the app's local event ingress. The event payload is rendered into the rule text as template variables (`{{workdir}}`, `{{summary}}`, etc.) before the agent runs. No polling; the run is immediate on event receipt.

A rule is one or the other, not both. This keeps the scheduler and the event ingress as separate, simple code paths. See [rule-config-schema.md §3](./rule-config-schema.md#3-trigger--how-the-rule-fires).

**Why a generic ingress, not Codex-specific monitoring.** Today's use case is "react when a Codex session completes." But the same mechanism serves "react when a build finishes," "when Claude Code completes a session," "when a file appears in ~/Downloads." So the app exposes a **generic local HTTP event listener** (§6.7), and external systems push events to it via small hook scripts or shell commands. Codex's first-party [hooks system](https://developers.openai.com/codex/hooks) fires a `session-complete` event; a hook script supplied (or documented) by LocalCortex POSTs that event to the ingress. The app itself contains no Codex-specific session-monitoring code.

```
External source                LocalCortex
─────────────                  ───────────
Codex session completes        HTTP listener on 127.0.0.1:PORT
  → hook script runs       →   event ingress receives POST
  → POST localhost:PORT        matcher finds rules for that eventType
                               → enqueues an agent run with event payload
                                 rendered into the rule text
```

---

## 4. Module layout

```
localcortex/
├── docs/
│   ├── architecture.md            ← this file
│   └── rule-config-schema.md
├── src/
│   ├── main/                      ← Electron main process
│   │   ├── index.ts               ← app bootstrap, window management
│   │   ├── ipc/                   ← IPC handlers (renderer ↔ main)
│   │   │   ├── rules.ts           ← CRUD over rules
│   │   │   ├── runs.ts            ← run history, manual trigger
│   │   │   └── servers.ts         ← read/validate mcp-servers.json
│   │   ├── scheduler/
│   │   │   ├── scheduler.ts       ← per-rule timers (tick-triggered rules only)
│   │   │   └── concurrency.ts     ← capped-parallelism queue (shared w/ events)
│   │   ├── events/
│   │   │   ├── ingress.ts         ← local HTTP listener (127.0.0.1:PORT/event)
│   │   │   ├── matcher.ts         ← routes events → rules by eventType + filter
│   │   │   └── codex-hook.sh      ← hook script for Codex session-complete (ships)
│   │   ├── agent/
│   │   │   ├── runner.ts          ← AgentRunner interface (backend-agnostic)
│   │   │   ├── claude.ts          ← ClaudeAgentRunner (options.cwd, mcpServers)
│   │   │   ├── codex.ts           ← CodexAgentRunner (workdir + .codex/config.toml)
│   │   │   ├── cli-resolver.ts    ← resolves local codex/claude CLI path (settings → PATH → bundled)
│   │   │   ├── prompt-builder.ts  ← renders event vars + assembles rule + status contract
│   │   │   └── staging.ts         ← per-run workdir setup + teardown
│   │   ├── mcp/
│   │   │   ├── lifecycle.ts       ← spawn per run, inject config, pass to SDK
│   │   │   ├── config-loader.ts   ← loads ~/.localcortex/mcp-servers.json
│   │   │   ├── config.ts          ← serialize to Claude mcpServers / Codex config.toml
│   │   │   └── default-config.ts  ← bundled default written on first launch
│   │   ├── sinks/                 ← task-manager clients (used by OmniFocus MCP server)
│   │   │   └── omnifocus-jxa/     ← custom MCP server package (JXA-backed)
│   │   │       ├── index.ts
│   │   │       └── scripts/       ← JXA scripts (create, find, update, close)
│   │   ├── db/
│   │   │   ├── schema.sql         ← rules, runs tables
│   │   │   ├── client.ts          ← SQLite wrapper
│   │   │   └── migrations/
│   │   └── observability/
│   │       ├── logger.ts          ← structured logs
│   │       └── run-recorder.ts    ← records prompt, tool calls, tokens, result
│   └── renderer/                  ← React UI
│       ├── rule-editor/           ← create/edit rules (NL rule, source, backend, …)
│       ├── run-history/           ← per-rule run list, tool-call inspection
│       ├── sources/               ← manage GitHub/GitLab connections + tokens
│       └── settings/              ← global tick interval, concurrency cap
```

### Key modules

- **`scheduler/`** — owns the per-rule timers for **tick-triggered** rules and the concurrency cap (shared with the event path). Reads `tickIntervalSeconds` per rule, falls back to the global default. Enqueues agent runs into the capped-parallelism queue.
- **`events/`** — the local event ingress for **event-triggered** rules. An HTTP listener on `127.0.0.1:PORT/event` receives POSTed JSON events from external sources (Codex hooks, Claude Code hooks, shell scripts, build tools). The matcher routes each event to rules registered for its `eventType`, optionally filtered by fields like `workdir`, and enqueues an agent run with the event payload rendered into the rule text as template variables. Ships a `codex-hook.sh` that bridges Codex's `session-complete` hook to the ingress. See [§6.7](./architecture.md#67-event-ingress--local-http-listener).
- **`agent/`** — the `AgentRunner` interface with two implementations (Claude, Codex). The prompt builder renders event template variables (`{{workdir}}`, `{{summary}}`, …) into the rule text, then assembles the full prompt with status contract + available MCP tools. Staging prepares the per-run workdir.
- **`mcp/`** — the MCP lifecycle manager. Loads `~/.localcortex/mcp-servers.json` (writing the bundled default on first launch), resolves each rule-referenced server name to its full spawn config, and serializes that config per backend (`mcpServers` for Claude, `.codex/config.toml` for Codex). Server definitions — including credentials — live in the user-editable file, not in code or SQLite. See [mcp-servers.md](./mcp-servers.md).
- **`sinks/omnifocus-jxa/`** — the custom OmniFocus MCP server (a separate package spawned as a stdio server). Implements create / update / close via JXA scripts.
- **`db/`** — single SQLite, app-owned. Tables: `rules`, `runs`. The agent runs themselves are stateless from the app's view; the DB tracks config and history. Credentials are **not** stored here — they live in the MCP server config file.
- **`observability/`** — records every run (prompt, tool calls, token cost, duration, result). The primary safety net under auto-execute.

---

## 5. MCP integration

### 5.1 Server definitions — user-editable config file

Server definitions live in a **user-editable JSON file** at `~/.localcortex/mcp-servers.json`, not in code. The app writes a bundled default on first launch containing the four v1 servers (with placeholder tokens the user fills in). Rules reference servers by name; the file holds the full spawn config — command, args, and credentials as plaintext env values. This is the same model Claude Desktop and other MCP clients use: users add or modify servers by editing the file, with no code change or schema migration. See [mcp-servers.md](./mcp-servers.md) for the file format, default config, resolution algorithm, and security notes.

The shipped default covers:

| Name | Role | Upstream | Status |
|---|---|---|---|
| `github` | source (read) | official `github-mcp-server` | robust |
| `gitlab` | source (read) | official GitLab Duo MCP or community `yoda-digital/mcp-gitlab-server` | robust |
| `todoist` | sink (write) | official Todoist MCP server | robust |
| `omnifocus` | sink (write) | **custom thin JXA wrapper** (bundled) | owned, minimal surface |

Users can rename these, add others (e.g., `github-personal` / `github-work` for multiple accounts), or add entirely new upstreams.

### 5.2 Write hosting — external stdio servers, uniformly

All MCP servers (read and write) are **external stdio servers**, spawned as child processes. Chosen over in-process `createSdkMcpServer` for three reasons:

1. **Concurrency-safe** — sidesteps the Claude Agent SDK [Issue #122](https://github.com/anthropics/claude-agent-sdk-typescript/issues/122) (concurrent `query()` calls sharing an in-process server collide).
2. **Uniform across backends** — identical pattern for Claude and Codex (Codex can only use external servers anyway). One lifecycle code path.
3. **Symmetry with read servers** — GitHub/GitLab are already external; writes use the same pattern.

### 5.3 OmniFocus — custom thin JXA wrapper

A minimal MCP server with three tools:

| Tool | Purpose |
|---|---|
| `create_task` | Create a task with name, note, and project |
| `update_task` | Modify an existing task |
| `close_task` | Mark a task complete |

Uses **JXA (JavaScript for Automation)** rather than AppleScript strings — Omni's official scripting API, less escaping fragility, callable from Node via `osascript -l JavaScript`. Owned because the community servers' AppleScript-string approach is brittle, and a minimal, controlled surface is easier to keep reliable than adapting a third-party server to the app's needs.

### 5.4 Lifecycle — respawn per run

Every agent run spawns the MCP servers it needs; they die when the run ends. At a 60-min cadence the ~2s cold-boot is irrelevant, and per-run isolation eliminates an entire class of bugs (zombie servers, stale connections, pool exhaustion). Each run is fully self-contained.

### 5.5 MCP config asymmetry between backends

| | Claude Agent SDK | Codex SDK |
|---|---|---|
| MCP config | Per-call: `options.mcpServers` | Config-file: `.codex/config.toml` in the workdir |
| Working dir | `options.cwd` | inferred from workdir / `startThread` |
| Approval | `canUseTool` callback (not used in v1 — auto-execute) | `approval_policy = "never"` in config.toml |
| CLI binary | `options.pathToClaudeCodeExecutable` | `codexPathOverride` (CodexOptions) |

Both are handled by the `AgentRunner` abstraction; the difference is invisible to the rest of the app. Each backend's CLI binary is resolved per run via [§6.5.1](./architecture.md#651-cli-resolution--local-vs-bundled-binary): an explicit path from Settings, else the first match on `PATH`, else the SDK's bundled vendored binary.

---

## 6. Execution model

### 6.1 Working directory — first-class rule field

Each rule declares a `workdir`. Used differently per backend:

- **Claude** — passed as `options.cwd` to `query()`. Independent of MCP config (which is passed in-call).
- **Codex** — `rule.workdir` is **ignored**. The SDK reads MCP config only from a `.codex/config.toml` in the directory it launches in (§5.5), and that file contains plaintext tokens (§8). Writing it into a user-chosen `workdir` would (a) pollute a real project with a token-bearing file, (b) clobber any pre-existing `.codex/config.toml` the user maintains there, and (c) be catastrophic if teardown failed — the file could be `git add`-ed and pushed. Instead the app always stages an ephemeral per-run workdir at `~/.localcortex/runs/<rule-id>/<timestamp>/`, writes the generated `.codex/config.toml` there, and deletes it at run teardown (§8). The two concerns — cwd and MCP config — converge in that one staged directory.

> **Known limitation (Codex):** because Codex's cwd is always the ephemeral staged dir, a Codex rule cannot run *in* `rule.workdir` the way a Claude rule can. A Codex rule that needs to read or modify files in a user-chosen directory must either (a) reach them by absolute path via MCP server tools, or (b) have its prompt reference `{{workdir}}` from an event payload and operate through MCP. A future iteration may honor `rule.workdir` for Codex by writing/restoring a `config.toml` inside it (and handling pre-existing config + gitignore concerns), but this is not done in v1.

### 6.2 Sandbox — tied to rule intent

| Rule intent | workdir | sandbox |
|---|---|---|
| Triage / read-only checks | user's project path | read-only |
| Draft changes for review | user's project path | workspace-write |
| Stateless transformation | per-rule scratch dir | workspace-write |

Claude: enforced via `allowedTools` whitelist. Codex: enforced via `--sandbox` / `sandbox_mode` in config.toml.

### 6.3 Safety — auto-execute

Both backends run unattended with approval disabled:

- Claude: `canUseTool` always-allow (or no callback).
- Codex: `approval_policy = "never"` in the per-run config.toml.

Writes happen immediately. **Observability is the safety net, not a review step.** Every run records prompt, tool calls, token cost, duration, result — for post-hoc debugging of non-determinism. There is no pre-write approval gate and no cross-run write deduplication (see [§8](./architecture.md#8-known-constraints--risks)).

### 6.4 Concurrency — capped parallelism

A queue caps concurrent agent runs (configurable, default e.g. 3). Excess runs queue. External stdio servers make parallelism safe by construction; the cap bounds token spend and resource use (e.g., prevents runaway cost after a network outage that backfills many ticks at once).

### 6.5 Cadence — global default + per-rule override

One global default interval (60 min). Any rule can override with its own `tickIntervalSeconds`. Because every tick is a full agent run, the interval is the primary cost control — lowering it raises token cost linearly with no steady-state savings.

### 6.5.1 CLI resolution — local vs. bundled binary

By default each backend's SDK spawns a **bundled, vendored** native binary resolved via `require.resolve` against a platform-specific npm package (`@openai/codex-darwin-arm64`, etc.). This means a globally installed `codex`/`claude` on the user's machine is ignored unless explicitly opted in.

To run against the locally installed CLI instead, Settings exposes two optional fields:

- **`codexCliPath`** — explicit path to a `codex` binary.
- **`claudeCliPath`** — explicit path to a Claude Code (`claude`) binary.

Resolution order (same for both backends, implemented in `agent/cli-resolver.ts`):

1. **Explicit Settings path** — if set and non-empty, used as-is (validated on save: must exist and be executable).
2. **`PATH` auto-detect** — otherwise a `which`-style scan of `process.env.PATH` for the first executable match.
3. **SDK default** — if neither yields a path, the runner passes nothing and the SDK spawns its bundled binary (the default behavior).

The provider reads the latest Settings on every run (not just at bootstrap), so changing a CLI path takes effect on the next run with **no app restart**. Bad paths are rejected at save time with an inline error in the Settings view; runtime failures from a wrong-but-executable binary still surface in run history.

### 6.6 Stop conditions — agent-signaled completion + structural backstop

Without a stop condition, every rule runs forever — including one-off rules like "remind me to merge MR !23494," which would keep re-fetching and re-evaluating long after the MR was merged, burning tokens each cycle. LocalCortex uses two complementary mechanisms:

**Primary — agent-signaled completion.** The agent is the only entity that understands the rule's intent (it lives in natural language), so only it can judge "is this rule's goal achieved?" The prompt contract requires the agent to emit a machine-readable status block at the end of its final message each run:

```json
{"status": "done", "reason": "MR !23494 was merged; reminder task created."}
```

`status` is one of:

| Status | Meaning | App action |
|---|---|---|
| `active` | Goal not yet met; keep polling | continue scheduling |
| `done` | Goal achieved or no longer relevant | disable the rule (`enabled = false`), log the reason |
| `error` | Could not complete (auth failure, item not found, etc.) | disable the rule, surface the error in the UI |

The app parses this JSON block from the agent's transcript. On `done` or `error`, it sets `enabled = false` and records the reason in run history. A disabled rule can be re-enabled manually by the user; doing so resets its run counter (fresh start).

**Backstop — structural limits.** Optional per-rule fields that bound waste regardless of whether the agent ever signals done:

- `maxRuns` (default e.g. 48, ≈2 days at 60-min cadence) — when the run count reaches the limit, the app disables the rule with a "max runs reached" note.
- `expiresAt` (ISO timestamp) — after this time, the rule is disabled.

If both are set, whichever triggers first disables the rule. These catch the case where the agent never decides to stop (e.g., a stalled MR that never merges) or where the status block fails to parse.

**Why both:** Agent-signaled completion alone can fail silently (the agent never emits `done` → runs forever). Structural limits alone are dumb (a rule that achieved its goal on run 1 still runs 47 more times). Together they cover the realistic failure modes — intelligence where it works, a floor where it doesn't.

**Manual override always wins.** The user can disable (`enabled = false`) or re-enable any rule at any time, regardless of how it was disabled. Auto-disabled rules show the disable reason in the UI.

### 6.7 Event ingress — local HTTP listener

For **event-triggered rules**, the app runs a local HTTP listener on `127.0.0.1:PORT/event` (loopback only — not exposed to the network). Any external process can POST a JSON event:

```bash
curl -s -X POST http://127.0.0.1:4729/event \
  -H "Content-Type: application/json" \
  -d '{
    "type": "codex.session-complete",
    "source": "codex",
    "sessionId": "abc-123",
    "workdir": "/Users/colin/code/web-app",
    "summary": "Refactored auth module; 3 files changed",
    "timestamp": "2026-07-07T14:23:00Z"
  }'
```

The ingress:

1. **Validates** the event has a `type` and `timestamp`; rejects malformed payloads with 400.
2. **Matches** the event to rules whose `trigger.eventType` equals the event's `type`, applying any optional filter (e.g., `workdir` glob). Multiple rules can match one event; each produces an independent agent run.
3. **Enqueues** each matched rule into the same capped-parallelism queue the scheduler uses (§6.4), with the event payload attached as context.
4. **Renders** the event payload into the rule text before the agent runs — `{{workdir}}`, `{{summary}}`, `{{sessionId}}` etc. become concrete values in the prompt.

### Bridging external systems to the ingress

The app contains no system-specific monitoring code. External systems push events via hook scripts or shell commands. LocalCortex ships one such bridge and documents the pattern for others:

- **Codex** — Codex's first-party [hooks system](https://developers.openai.com/codex/hooks) fires a `session-complete` event. LocalCortex ships `codex-hook.sh`, which the user installs into their Codex hooks config; it POSTs the session context to the ingress.
- **Claude Code** — Claude Code's hooks similarly fire on session/stop events; an equivalent shell hook POSTs to the ingress.
- **Arbitrary** — any script (`make`, CI, a `git` post-commit hook) can `curl` the endpoint. The ingress is just an HTTP listener.

This makes the event surface open-ended: a new event source needs only a script that POSTs JSON, not a code change in LocalCortex.

---

## 7. Per-run flow (end to end)

A run is enqueued by one of two paths, then shares everything from step 2 onward:

**Trigger (one of):**
- **Tick** — the scheduler fires a rule whose `trigger.type === "tick"` at its `tickIntervalSeconds`. No payload.
- **Event** — the event ingress receives a POST, matches it to rules whose `trigger.eventType` equals the event's `type`, and enqueues each with the event payload attached.

**Shared flow:**

1. A run is dequeued from the capped-parallelism queue (§6.4).
2. **Staging** prepares the per-run workdir (Codex: writes `.codex/config.toml`).
3. **MCP lifecycle** spawns the servers the rule needs (read + write), wires credentials.
4. **Prompt builder** renders the event payload into the rule text (event-triggered only — `{{workdir}}`, `{{summary}}`, etc. become concrete values), then assembles: rule + status contract + available MCP tools.
5. **AgentRunner** (Claude or Codex per rule) runs the agent in the workdir with MCP servers attached. The agent:
   a. Fetches current state via MCP per the rule text (e.g., "MR !23494 from GitLab").
   b. Evaluates the rule against that state.
   c. Performs writes to the sink via MCP as the rule directs.
   d. Emits a status block (`{"status":"active|done|error","reason":"..."}`) at the end of its final message.
6. **Run recorder** logs every tool call, token cost, result, and the parsed status. Every run is recorded — including agent-side failures: if the runner throws post-staging (e.g. missing API key, placeholder token at spawn), the failure is recorded as an `error` run (with the error message) rather than thrown away. Only setup problems that occur before there is a prompt to record (missing rule, undefined MCP server) propagate as exceptions.
7. **Stop check:** if the parsed status is `done` or `error`, the app sets `enabled = false` and records the reason. Also checked: `maxRuns` and `expiresAt` backstops.
8. MCP servers torn down, workdir optionally archived.

---

## 8. Known constraints & risks

- **Per-cycle cost is unavoidable.** Every tick spins up the agent to re-fetch and re-evaluate source state, even when nothing changed. The global default interval (60 min) is set conservatively to bound this; lowering it raises cost linearly. If this becomes a real problem, a deterministic poller can be layered in front of the agent later without re-architecting — the scheduler already owns the cadence, and a poller is just a "should we wake the agent?" check inserted before step 2.
- **No cross-run write deduplication.** Each agent run is a fresh session with no memory of prior writes, and the app does not track which writes a rule has already performed. The status contract protects **one-off** rules (a rule signaled `done` stops running before it can re-create the same task), but **ongoing rules** — those whose status stays `active` indefinitely, like "watch all my PRs and create a task for any stale one" — may create duplicate tasks on each cycle, because the agent has no way to know it already created a task for the same item on a previous run. One-off rules are also at risk if status parsing fails (the rule keeps running and duplicates on the next cycle). Users should expect to de-duplicate manually in the task manager, or keep ongoing rules scoped narrowly. If this proves painful, an idempotency mechanism (a key written into each task's note at creation + a `find_by_key` content search before creating) can be added without re-architecting — it slots into the prompt contract and the write MCP servers. See [rule-config-schema.md §11](./rule-config-schema.md#11-open-questions-for-future-iterations).
- **Codex path is the harder one.** Config-file MCP, workdir staging, and the `exec`-mode approval limitations mean the Codex `AgentRunner` carries more complexity than Claude's. ~70% of integration debugging will land here. See [Issue #26602](https://github.com/openai/codex/issues/26602) for an example of `codex exec` flag friction.
- **OmniFocus JXA wrapper** is single-machine and process-spawn-per-call. Slower than a REST sink; acceptable at low write volume.
- **Credentials are stored as plaintext in `~/.localcortex/mcp-servers.json`.** This is the deliberate trade-off of the user-editable config-file approach: the file is self-contained and simple, but anyone with read access to the user's home directory can read the tokens. Mitigation: the app creates the file with `0600` permissions; users who need stronger protection can store it on an encrypted volume. See [mcp-servers.md §8](./mcp-servers.md#8-security-notes).
- **Codex per-run `config.toml` duplicates tokens into the workdir.** Each Codex run writes a `.codex/config.toml` containing the same plaintext tokens (Codex reads MCP config only from a file, not per-call). The staging module must delete the workdir at run teardown — otherwise plaintext tokens accumulate under `~/.localcortex/runs/`. Claude avoids this entirely (per-call config, nothing written to disk).
- **Codex teardown is best-effort, so `rule.workdir` is not honored.** Teardown runs in a `finally` block, so it covers normal success *and* thrown-error paths — but **not** process death (app crash, force-quit, `SIGKILL`, power loss). If a token-bearing `config.toml` were written into the user's `rule.workdir` and teardown never ran, the file would survive in a real project — at risk of being `git add`-ed and pushed, and overwriting any pre-existing `.codex/config.toml` the user maintains there. The design therefore stages Codex runs in an app-owned ephemeral dir (`~/.localcortex/runs/<rule-id>/<timestamp>/`) where a missed teardown is merely a token file in an obscure folder, not a leak into the user's repo. A future iteration may honor `rule.workdir` for Codex by write-then-restore of a `config.toml` (handling pre-existing config + gitignore), but this is deferred. See §6.1.
- **Codex rules cannot draft filesystem changes that persist.** Because the Codex cwd is the ephemeral staged dir (deleted at teardown), any files the agent writes to its working directory are wiped at run end. A Codex rule that needs to create or modify files in a real project must do so through MCP server tools that target absolute paths, not by writing into its cwd. Claude does not have this restriction (`rule.workdir` is honored, and Claude writes nothing to disk).
- **Auto-execute means mistakes land in the task manager immediately.** Idempotency keys prevent duplicates but not *wrong* tasks. Observability + easy bulk-edit in the UI are the mitigation. A future dry-run mode or per-run interactive gate (Claude's `canUseTool`) can layer on later without re-architecting.
- **Stop-condition detection depends on parsing a JSON suffix from the agent's output.** If the agent omits the status block, emits malformed JSON, or embeds it mid-message where the parser can't find it, the app can't detect `done` and the rule keeps running until it hits the `maxRuns`/`expiresAt` backstop (or runs forever if neither is set). Mitigation: the parser should be lenient (scan the whole transcript for the first valid status block), the prompt contract should strongly emphasize the suffix requirement, and `maxRuns` should have a sensible default so no rule is truly unbounded. If parsing proves unreliable in practice, the fallback is a dedicated `set_rule_status` tool call instead of a JSON suffix.
- **The event ingress is a local HTTP listener.** It binds to `127.0.0.1` only (loopback, not the network), but any process running as the user can POST events to it and trigger agent runs — which under auto-execute means writes to the task manager. Mitigation: bind strictly to loopback, optionally require a shared secret token in the POST header (configured in settings), and log every received event. The blast radius is bounded by `mcpServers` (a rule can only touch its declared servers) but a malicious local process could still trigger spurious runs.
- **No Mac App Store distribution.** Developer ID + notarize only, due to subprocess/secret-access requirements.

---

## 9. Deferred / out of scope for v1

- **Deterministic poller in front of the agent** — a cheap "anything changed?" check to skip the agent run when there's no delta. Explicitly *not* used in v1; the agent re-fetches every cycle. Can be added later if per-cycle cost becomes a problem.
- Cross-source rules (a rule watching GitHub + GitLab together).
- Interactive per-write approval gate (Claude `canUseTool`), two-phase Codex emulation.
- Webhook triggers (would require a public endpoint or tunnel).
- Long-lived MCP server pool (only if respawn-per-run latency becomes a measured problem).
- Additional sources beyond GitHub + GitLab.
- In-process `createSdkMcpServer` for writes (only if external-server overhead or type-safety becomes a real pain).
