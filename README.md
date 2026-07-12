# LocalCortex

A local-first Electron + TypeScript desktop app that runs user-defined **natural-language rules** on a schedule to detect updates from external systems (GitHub, GitLab) and route them to a task manager (OmniFocus, Todoist). Rules are executed by **Codex** or **Claude Code**, which reach external systems through **MCP servers**.

The app is a scheduler, an event listener, a prompt manager, and an MCP-server orchestrator. It owns almost no integration code — the agents and the MCP servers do the integration work.

> **Status:** skeleton/scaffolding implementation against the design docs in [`docs/`](./docs). Verified: type-checks, lints, formats, and unit-tests clean (114 tests); and the full Electron app builds, packages to `LocalCortex.app`, and launches (DB migrates, event ingress starts). Real agent execution (live Claude/Codex runs, real external writes) is not exercised here — it needs API keys and is non-deterministic.

## How it works

Every scheduled **tick** (or matching **event**) wakes an agent. The agent:

1. fetches source state via MCP (issues, PRs, merge requests),
2. evaluates the user's natural-language rule against what it finds,
3. acts on the task manager (create/update tasks) via MCP, and
4. emits a status block (`active`/`done`/`error`) the app parses to decide whether to keep the rule running.

Two trigger models (architecture.md §3.4):

- **Tick** — the scheduler fires a rule on `tickIntervalSeconds` (default 60 min).
- **Event** — a local HTTP listener (`127.0.0.1:4729/event`) receives POSTed events (e.g. a Codex session completing) and fires matching rules immediately.

## Project layout

```
localcortex/
├── docs/                     # authoritative design docs
├── src/
│   ├── shared/               # Zod schemas + TS types (one validation surface)
│   ├── main/                 # Electron main process
│   │   ├── index.ts          # app bootstrap, window, wiring
│   │   ├── preload.ts        # contextBridge → window.api
│   │   ├── ipc/              # rules / runs / servers / settings handlers
│   │   ├── scheduler/        # per-rule timers + capped-parallelism queue
│   │   ├── events/           # HTTP ingress + event→rule matcher + codex hook
│   │   ├── agent/            # AgentRunner (Claude/Codex), prompt builder, run-loop
│   │   ├── mcp/              # config loader/resolver/serializer + lifecycle
│   │   ├── db/               # node:sqlite client, migrations, repositories
│   │   └── observability/    # logger + run recorder
│   └── renderer/             # React 19 + Tailwind 4 + shadcn/ui + Zustand
├── playwright/               # Electron E2E
└── vitest-shims/             # node:sqlite test shim (see “Testing” below)
```

See [`docs/architecture.md §4`](./docs/architecture.md#4-module-layout) for the full module map.

## Prerequisites

- **Node.js ≥ 22.14** (required for the built-in `node:sqlite`). Use nvm:
  ```bash
  nvm use v22.14.0
  ```
- macOS (the rest is cross-platform).

## Setup

```bash
nvm use v22.14.0
npm install
```

On first launch the app seeds the `mcp_servers` DB table with four default
servers (`github`, `gitlab`, `todoist`, `omnifocus`) — the first three carrying
`<your-token-here>` placeholders. **Fill in real tokens in the Sources tab**
before running rules — the lifecycle manager rejects servers that still hold a
placeholder.

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
- MCP config loader / resolver / serializer (Claude + Codex TOML) + placeholder check
- concurrency queue (capped parallelism)
- scheduler (cadence math + per-rule timers, fake-timer-injectable)
- stop-check (agent-signaled + structural backstops)
- run-loop (full enqueue→stage→run→record→stop-check with a stub runner + in-memory DB)
- DB migrations + all three repositories (against in-memory `node:sqlite`)

```bash
npm test   # 114 tests across 11 files
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

- **Per-cycle cost is unavoidable** — every tick is a full agent run. Default
  cadence is conservative (60 min) to bound token cost.
- **No cross-run write deduplication** — ongoing rules (status stays `active`)
  may create duplicate tasks on each cycle. Users de-duplicate manually.
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

- [`docs/architecture.md`](./docs/architecture.md) — the authoritative architecture reference.
- [`docs/rule-config-schema.md`](./docs/rule-config-schema.md) — the user-facing rule config format.
- [`docs/features/mcp-sources/README.md`](./docs/features/mcp-sources/README.md) — the MCP server config format, Sources-tab CRUD, and resolution.
- [`docs/tech-stack.md`](./docs/tech-stack.md) — concrete tech choices, rationale, and gotchas.
