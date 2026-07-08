# AGENTS.md

Notes for ZCode agents working in this repo. The [README](./README.md) and
[`docs/`](./docs) are the authoritative reference; this file captures the
operational facts and conventions that matter for making correct edits.

## What this is

LocalCortex is a local-first **Electron + TypeScript** desktop app that runs
user-defined natural-language **rules** on a schedule. Each tick/event wakes a
**Codex** or **Claude Code** agent that fetches state via **MCP servers** and
writes to a task manager (OmniFocus/Todoist). The app is a scheduler + event
listener + prompt manager + MCP orchestrator; it owns almost no integration
code.

## Toolchain & commands

- **Node ≥ 22.14** is required (built-in `node:sqlite`). Run `nvm use v22.14.0`
  before any npm command.

| Task | Command |
| --- | --- |
| Typecheck (strict, whole project) | `npm run typecheck` |
| Lint (flat ESLint config, type-checked) | `npm run lint` / `npm run lint:fix` |
| Format | `npm run format` / `npm run format:check` |
| Unit tests (Vitest) | `npm test` |
| Unit tests, watch | `npm run test:watch` |
| E2E (Playwright Electron) | `npm run test:e2e` — **not** part of `npm test` |
| Launch dev app | `npm start` |

A ZCode Stop hook (`.zcode/config.json` → `.zcode/scripts/lint-and-typecheck.sh`)
runs `typecheck` + `lint` automatically after each turn and blocks (exit 2) on
failure. Keep edits passing both.

## Module layout & boundaries

Three Electron layers under `src/`:

- **`src/shared/`** — the single source of truth for Zod schemas + TS types and
  app constants. Both processes import from here. When a shape changes, update
  it here once.
- **`src/main/`** — privileged Electron main process: Node, filesystem, DB,
  CLIs, MCP, scheduler, HTTP ingress. Further divided into `db/`, `mcp/`,
  `agent/`, `scheduler/`, `events/`, `ipc/`, `observability/`.
- **`src/renderer/`** — sandboxed React 19 + Tailwind 4 + Zustand UI. Touches
  the main process **only** through `window.api` (the preload bridge). No
  `require`, no filesystem, no CLIs.

Boundary rules that matter:

- **IPC channel = `domain:action`** (e.g. `rules:create`). Channels are declared
  as constants in `src/shared/schemas/ipc-schema.ts` (`IPC` object). Every main
  handler validates its payload with a Zod schema **before** acting
  (see `src/main/ipc/rules.ts` for the pattern). Add a new channel by extending
  `IPC`, adding a schema, registering the handler, and exposing it on the
  preload `api`.
- **SQL lives only in `src/main/db/`** repositories. Business logic calls
  repository methods; never inline SQL elsewhere. The DB client
  (`src/main/db/client.ts`) applies WAL + foreign-key PRAGMAs and takes a path
  so tests can pass `:memory:`.
- **The agent layer (`src/main/agent/`) is backend-agnostic.** `runner.ts` holds
  only the `AgentRunner` interface and stays SDK-free; the Claude/Codex
  differences live in `claude.ts`/`codex.ts`. Don't push backend specifics into
  the shared interface.

## Coding conventions

- **Path aliases** (configured in `tsconfig.json`): `@shared/*`, `@main/*`,
  `@renderer/*`. Prefer these over deep relative imports.
- **Strict TypeScript.** Notably `noUncheckedIndexedAccess` and
  `noUnusedLocals`/`noUnusedParameters` are on. Prefix intentionally-unused
  params/vars with `_` (the ESLint rule ignores `^_`).
- **Zod is the one validation surface.** Define schemas in `src/shared/schemas/`
  and derive TS types with `z.infer` (see `src/shared/types.ts`). Don't
  hand-write parallel type definitions. Note the project deliberately uses
  **Zod 4** (not the 3.x in the docs) because the Claude Agent SDK requires it.
- **Factor pure logic out of Electron APIs** so it's unit-testable in plain
  Vitest. The `logger` (`src/main/observability/logger.ts`) is the canonical
  example — `electron-log` is imported lazily so pure modules importing it stay
  testable. Follow that pattern when adding main-process modules.
- **No `"type": "module"` in `package.json`** — on purpose. Electron Forge's
  Vite plugin emits CommonJS for main/preload; with ESM mode the emitted
  `require()` breaks. Source still uses ESM `import`/`export` (Vite transpiles
  it). Config files that must run as ESM are `.mjs` (e.g. `eslint.config.mjs`).
- **Imports use `.js` extensions in `src/main/`** (e.g.
  `from '../db/client.js'`) because the bundled output is CJS; match this in
  new files.

## Gotchas

- **`node:sqlite` under Vitest**: Vite's optimizer strips the `node:` prefix and
  fails to resolve bare `sqlite`. The `vitest-shims/node-sqlite.ts` shim
  re-exports the built-in via `createRequire`, aliased in `vitest.config.ts`.
  Production builds externalize `node:sqlite` normally. Don't remove the shim or
  the alias.
- **SQL migrations are inlined via Vite `?raw` imports**, not loaded from disk
  at runtime — the bundled `main.js` lands in `.vite/build/` so a filesystem
  scan would miss the `.sql` files. Add migrations as `?raw` imports in
  `src/main/db/migrate.ts`.
- **MCP server tokens are plaintext** in `~/.localcortex/mcp-servers.json`
  (`0600`). Servers still holding the `PLACEHOLDER_TOKEN`
  (`<your-token-here>`, defined in `src/shared/constants.ts`) are rejected by
  the lifecycle manager at run time. Don't commit real tokens or
  `mcp-servers.json`.
- **Event ingress is loopback-only** (`127.0.0.1:4729`) but any process as the
  user can POST; an optional `x-localcortex-secret` header gates it.

## Docs to read before touching sensitive areas

- [`docs/architecture.md`](./docs/architecture.md) — authoritative architecture
  reference (module map §4, lifecycle §5–7, constraints §8, out-of-scope §9).
- [`docs/rule-config-schema.md`](./docs/rule-config-schema.md) — rule config
  format + validation rules enforced before save (§11).
- [`docs/mcp-servers.md`](./docs/mcp-servers.md`) — MCP server config file
  format, resolution, and placeholder rules.
- [`docs/tech-stack.md`](./docs/tech-stack.md) — concrete tech choices, rationale,
  and the "factor logic out of Electron" testing rule (§5).
- [`docs/features/`](./docs/features/) — per-feature specs (rules, triggers,
  stop-conditions, agent-backends, mcp-sources, observability, settings).

Source files cite the relevant doc section in their header comment — follow
those references when extending.
