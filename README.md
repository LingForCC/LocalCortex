# LocalCortex

A local-first Electron + TypeScript desktop app whose **main job is the
handoff**: when a coding-agent session (ZCode, Codex, or Claude Code) finishes,
LocalCortex automatically creates a **review subtask** under the task-manager
item (OmniFocus, Todoist, …) the agent was working on — so you're reminded to
review the agent's work later without watching the session.

The agent runs and reaches external systems through **MCP servers**. Under the
hood LocalCortex is still a scheduler, an event listener, a prompt manager, and
an MCP-server orchestrator: it owns almost no integration code. A handoff is
simply an event-triggered rule whose prompt is built from context you attach to
a session, fulfilled by Codex or Claude Code. That same machinery is available
for your own general natural-language rules too.

> **Status:** the handoff feature is the focus of the app. It type-checks,
> lints, formats, and unit-tests clean, the Electron app builds/packages/launches
> (DB migrates, event ingress starts), and the hook plugins + bridge scripts ship
> in-tree. Live agent execution (real Claude/Codex runs, real external writes)
> is not exercised in CI — it needs API keys and is non-deterministic.

---

## The handoff — what it does

The canonical flow:

1. You hand a long-running agent session off to work on a task-manager item (an
   OmniFocus task, a Todoist task, …).
2. While the session runs, you **attach a handoff** to it — the agent's session
   id plus a little context (e.g. the parent task's id/name).
3. When the session completes (or a round ends), the agent's **Stop hook** POSTs
   a `<source>.session-complete` event to LocalCortex.
4. LocalCortex **correlates** the session id to your handoff, **merges** the
   context into the event, and an event-triggered **rule** runs an agent with
   your task manager's MCP server to create the review subtask.
5. You get the reminder in your task manager — no session-watching required.

Handoffs are **manager-agnostic** and **agent-source-agnostic**: LocalCortex is a
dumb pipe that stores an opaque session id + an opaque key-value `context` map
and forwards the context to the fulfilling rule. Adding a new task manager or
agent source needs no code change — only rule/profile text and (for a new agent
source) a hook script. A handoff has an **enable/disable** toggle (not a
fulfilled/pending lifecycle): while enabled it fires on every matching
session-complete event, so a multi-round session creates a reminder each round.

A second hook (`UserPromptSubmit`) opens a **popup** the moment you submit a
prompt in a backed agent, letting you attach (or toggle) a handoff right when
the session starts — instead of remembering to register it mid-task.

See [`docs/features/handoffs/README.md`](./docs/features/handoffs/README.md) for
the full flow, context keys, and sample rules.

---

## Setup

### Prerequisites

- **Node.js ≥ 22.14** (required for the built-in `node:sqlite`). Use nvm:
  ```bash
  nvm use v22.14.0
  ```
- macOS (the rest is cross-platform).

### 1. Install the app

```bash
nvm use v22.14.0
npm install
npm start
```

On first launch the app seeds the `mcp_servers` DB table with default servers
(`github`, `gitlab`, `todoist`, `omnifocus`) — several carrying
`<your-token-here>` placeholders, plus builtin coding agents (ZCode, Codex,
Claude Code) and task managers.

### 2. Install lifecycle hooks on your coding agents (once per agent source)

Each agent source needs a **Stop** hook (to notify LocalCortex when a session
ends) and, optionally, a **UserPromptSubmit** hook (to open the attach popup on
prompt submit). The easiest path is the bundled **`localcortex-hook` plugins**,
which register both hooks across every workspace in one step:

| Agent | Plugin / script |
| --- | --- |
| **ZCode** | [`packaging/zcode-hook-plugin/`](./packaging/zcode-hook-plugin/) |
| **Claude Code** | [`packaging/claude-hook-plugin/`](./packaging/claude-hook-plugin/) (Claude Code is a builtin agent, so no custom catalog entry is needed) |
| **Codex** | [`packaging/codex-hook-plugin/`](./packaging/codex-hook-plugin/), or wire [`src/main/events/codex-hook.sh`](./src/main/events/codex-hook.sh) + [`codex-prompt-submit-hook.sh`](./src/main/events/codex-prompt-submit-hook.sh) into your Codex hooks config |

Each emits a source-specific event type (`zcode.session-complete`,
`codex.session-complete`, `claude-code.session-complete`, …) that the matching
rule listens for. Adding a new agent (Cursor, …) is just a new hook script + a
custom catalog entry — no LocalCortex code change.

### 3. Configure your task manager's MCP server (Sources tab)

In the **Sources** tab, point the seeded server (e.g. `omnifocus`) at your
external MCP server and **fill in real tokens** — the lifecycle manager rejects
servers that still hold a `<your-token-here>` placeholder. You can add any other
task manager the same way (form or paste JSON from the server's README).

### 4. Create a handoff profile (Handoff profiles tab)

A **handoff profile** binds together the three choices that specialize the app
around the handoff use case, and **auto-creates the fulfilling rule** for you:

| Choice | What it determines |
| --- | --- |
| **Coding agent** | The *event source* — which `session-complete` event type the rule listens to. |
| **Task manager** | The *sink* — which MCP server creates the review subtask. |
| **Review-rule backend** | Which runner (**Claude** or **Codex**) fulfills the rule. |

The three choices are **independent** — e.g. you can work in ZCode and have the
Codex SDK fulfill the review. You can run **multiple profiles simultaneously**:
because each agent emits a distinct event type, the matcher fires every matching
profile independently (e.g. ZCode → OmniFocus and Codex → OmniFocus, both
active). Saving a profile builds a normal event-triggered rule (visible/editable
under Rules → Advanced), wires its MCP server, and interpolates the task
manager's task-creation instructions into the prompt so the agent knows the exact
MCP tool to call.

### 5. Attach a handoff (per task)

When you start a session in a backed agent, the **prompt-submit popup** opens:
paste/confirm the session id, add context rows (`parentTaskId`,
`parentTaskName`, …), and **Attach handoff**. (You can also register one any
time from the **Handoffs** panel.) When the session completes, the review
subtask is created automatically. Toggle the handoff off when you no longer want
reminders for that session.

---

## Project layout

```
localcortex/
├── docs/                     # authoritative design docs
├── packaging/                # localcortex-hook plugins (zcode / claude-code / codex)
├── src/
│   ├── shared/               # Zod schemas + TS types (one validation surface)
│   ├── main/                 # Electron main process
│   │   ├── index.ts          # app bootstrap, window, wiring
│   │   ├── preload.ts        # contextBridge → window.api
│   │   ├── ipc/              # rules / runs / servers / handoffs / profiles / settings handlers
│   │   ├── scheduler/        # per-rule timers + capped-parallelism queue
│   │   ├── events/           # HTTP ingress + event→rule matcher + handoff enrichment + hooks
│   │   ├── agent/            # AgentRunner (Claude/Codex), prompt builder, run-loop
│   │   ├── handoff-profiles/ # profile ↔ rule ownership logic
│   │   ├── mcp/              # config loader/resolver/serializer + lifecycle
│   │   ├── db/               # node:sqlite client, migrations, repositories
│   │   └── observability/    # logger + run recorder
│   └── renderer/             # React 19 + Tailwind 4 + shadcn/ui + Zustand
├── playwright/               # Electron E2E
└── vitest-shims/             # node:sqlite test shim (see "Testing" below)
```

The renderer shell is organized around the handoff use case: **Home** (profile +
recent-handoff summary), **Handoff profiles**, **Handoffs**, **Run history**,
then **Rules** / **Sources** under Advanced and **Settings**.

See [`docs/architecture.md §4`](./docs/architecture.md#4-module-layout) for the
full module map.

## Scripts

| Script                    | What it does                                              |
| ------------------------- | --------------------------------------------------------- |
| `npm start`               | Launch the app via Electron Forge (dev mode).             |
| `npm run typecheck`       | `tsc --noEmit` over the whole project (strict).           |
| `npm run lint`            | ESLint (flat config, type-checked).                       |
| `npm test`                | Vitest unit tests (pure-logic + DB).                      |
| `npm run test:e2e`        | Playwright Electron E2E (slower; not part of `npm test`). |
| `npm run format`          | Prettier write.                                           |
| `npm run package`         | Package the app via Electron Forge.                       |

## Testing

The cardinal rule (tech-stack.md §5): **factor pure logic out of Electron APIs**
so it's unit-testable in plain Vitest. The following are fully unit-tested:

- prompt builder (template rendering + status contract assembly)
- status-block parser (lenient transcript scan)
- event matcher (eventType + glob filters)
- handoff enrichment (session-id correlation + context merge)
- handoff-profile profile ↔ rule ownership logic
- MCP config loader / resolver / serializer (Claude + Codex TOML) + placeholder check
- concurrency queue (capped parallelism)
- scheduler (cadence math + per-rule timers, fake-timer-injectable)
- stop-check (agent-signaled + structural backstops)
- run-loop (full enqueue→stage→run→record→stop-check with a stub runner + in-memory DB)
- DB migrations + repositories (against in-memory `node:sqlite`)

```bash
npm test
```

### The `node:sqlite` test shim

Vitest runs under Vite, whose optimizer strips the `node:` prefix from
`import … from 'node:sqlite'` and then fails to resolve the bare `sqlite`.
The workaround is a one-line ESM shim (`vitest-shims/node-sqlite.ts`) that
re-exports the built-in via `createRequire`, aliased in `vitest.config.ts`.
Production builds externalize `node:sqlite` normally and are unaffected.

## Architecture decisions & deviations from the docs

The docs are the source of truth; these are deliberate deviations made during
implementation, with rationale:

- **Zod 4.x (docs specify 3.x).** The current `@anthropic-ai/claude-agent-sdk`
  requires `zod@^4` as a peer dependency. Zod 4 is backward-compatible for this
  app's usage (`.object`/`.parse`/`z.infer`), so the bump avoids a broken peer
  resolution. `@modelcontextprotocol/sdk` accepts both Zod 3 and 4.
- **`@electron/fuses` is a direct dependency.** `@electron-forge/plugin-fuses`
  does not re-export `FuseVersion`/`FuseV1Options`, so they're imported from
  `@electron/fuses` directly (version pinned to match what the plugin uses).
- **No `"type": "module"` in `package.json`.** Electron Forge's Vite plugin
  outputs CommonJS for the main/preload targets; with `"type":"module"` Node
  treats `.js` as ESM and `require()` (emitted by the CJS output) is undefined.
  Source files still use ESM syntax (`import`/`export`) — Vite transpiles them —
  and the standalone ESLint config is `.mjs` so it runs as ESM.
- **SQL migrations are inlined via Vite `?raw` imports** (not discovered from
  disk). The Forge/Vite bundle places `main.js` in `.vite/build/`, so a
  filesystem-based `./migrations/` lookup would miss the unbundled `.sql` files.
  Inlining keeps the runner identical across dev, packaged app, and tests.

Everything else follows the docs: Electron Forge + Vite template, React 19 +
Tailwind 4 + shadcn-style primitives + Zustand, `node:sqlite` + raw SQL + Zod
row validation, Fastify loopback ingress, electron-log, Vitest + Playwright.

## Known constraints (from the docs)

See [`docs/architecture.md §8`](./docs/architecture.md#8-known-constraints--risks).
Highlights:

- **Per-cycle cost is unavoidable** — every firing is a full agent run.
- **No cross-run write deduplication** — an enabled handoff may create a
  duplicate review subtask on each round of a multi-round session. Users
  de-duplicate manually, or toggle the handoff off.
- **Credentials are plaintext in the `mcp_servers` SQLite table** (Electron's
  userData directory) — same posture as a `0600` config file. Codex passes
  tokens per-run as `--config` CLI args (visible in `ps`, no file on disk).
- **Auto-execute** — writes land in the task manager immediately. Observability
  (run history) is the safety net, not a pre-write gate.
- **Event ingress** is loopback-only but any process as the user can POST events.
  An optional shared-secret header (`x-localcortex-secret`) can be required.

## Not yet implemented / out of scope for v1

Per [`docs/architecture.md §9`](./docs/architecture.md#9-deferred--out-of-scope-for-v1):
deterministic poller, cross-source rules, interactive per-write approval,
webhook triggers, long-lived MCP pool, code signing/notarize, auto-update.

## Documentation

- [`docs/features/handoffs/README.md`](./docs/features/handoffs/README.md) — **the handoff flow, context keys, hook setup, and sample rules.**
- [`docs/features/handoff-profiles/README.md`](./docs/features/handoff-profiles/README.md) — the three-choice profile model and auto-created rules.
- [`docs/architecture.md`](./docs/architecture.md) — the authoritative architecture reference.
- [`docs/features/rules/README.md`](./docs/features/rules/README.md) — the user-facing rule config format (fields, types, validation).
- [`docs/features/mcp-sources/README.md`](./docs/features/mcp-sources/README.md) — the MCP server config format, Sources-tab CRUD, and resolution.
- [`docs/tech-stack.md`](./docs/tech-stack.md) — concrete tech choices, rationale, and gotchas.
