# Tech Stack

Concrete technology choices for LocalCortex, with rationale and the gotchas that will actually cost time. This is the reference a new contributor reads to understand *what* we use and *why*; the high-level summary lives in [architecture.md §2](./architecture.md#2-tech-stack).

---

## 1. Stack at a glance

| Layer | Choice | Version target |
|---|---|---|
| Runtime | Electron | 35+ (bundles Node 22.14, enabling `node:sqlite`) |
| Language | TypeScript (strict) | 5.x |
| Build / package / distribute | Electron Forge (Vite template) | Forge 7+, Vite 6+ |
| Renderer UI | React + Tailwind CSS + shadcn/ui | React 19, Tailwind 4 |
| Renderer state | Zustand | 5.x |
| Agent SDKs | `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk` | latest |
| Database | `node:sqlite` (Node built-in) | bundled |
| Data-access pattern | Raw SQL + Zod row validation (no ORM) | — |
| Validation | Zod | 3.x |
| Event ingress (local HTTP) | Fastify | 5.x |
| Logging | electron-log | 5.x |
| Unit tests | Vitest | 2.x |
| E2E tests | Playwright (`@playwright/test`) | 1.49+ |
| Lint / format | ESLint + Prettier | ESLint 9, Prettier 3 |
| Code signing / notarize | Electron Forge makers + Apple Developer ID | — |

---

## 2. Why each choice

### Electron 35+ + TypeScript
Both agent SDKs ship as first-party TypeScript packages, so the entire agent layer (scheduler, runner, MCP wiring) shares one language with the UI. Electron 35 is the floor because it's the first version bundling Node 22.14, which is where `node:sqlite` becomes usable. TypeScript strict mode is non-negotiable for a main-process-heavy app that spawns subprocesses and defines IPC contracts.

### Electron Forge (with Vite template)
[Electron Forge](https://electronforge.io/) is the officially-recommended build/distribution tool — it handles `.dmg`/`.app` creation, code signing, notarization, and auto-update. Its Vite template gives Vite's fast HMR in dev while Forge handles production packaging. We deliberately avoid [electron-builder](https://www.electron.build/) and standalone [electron-vite](https://electron-vite.org/) to keep one toolchain; electron-vite itself [recommends Forge for production](https://electron-vite.github.io/faq/electron-forge.html).

### React + Tailwind + shadcn/ui
The renderer is config forms (rule editor), tables (run history, event log), and log viewers (agent transcripts). shadcn/ui — copy-in components built on Radix + Tailwind — is the right shape for this: no heavy component-library dependency, full control of styling, and the components match the use case. [React 19 + Tailwind 4 + shadcn is the 2026 consensus](https://www.reddit.com/r/reactjs/comments/1l098xe/electron_react_app_v11/) for new Electron apps.

### Zustand
Lighter than Redux, no provider boilerplate. The renderer's data layer is synchronous IPC calls to the main process, not async REST — so React Query / TanStack Query would add abstraction without value. Plain Zustand stores fed by `ipcRenderer.invoke` is enough.

### `node:sqlite` (Node built-in) — the key decision
[Node's built-in SQLite module](https://nodejs.org/api/sqlite.html) reached Release Candidate status (1.2) in early 2026 and is bundled into Electron 35+. Using it eliminates the single most painful class of Electron build bugs: native-module ABI mismatches. There is no `.node` binary to rebuild, no `asarUnpack` configuration, no `drizzle-kit` / `NODE_MODULE_VERSION` conflict. It just runs.

Trade-offs we accept:
- **Experimental/RC status.** The API is stable enough for our needs but could change. We isolate all DB access behind a data-access module so a future migration is contained.
- **No ORM.** Drizzle doesn't yet officially support `node:sqlite` as a driver. Rather than write a custom adapter, we use **raw SQL + Zod row validation** — parse every query result through a Zod schema to get typed rows. For a 2-table schema (rules, runs), this is genuinely fine and keeps the dependency surface minimal.
- **Electron enablement.** May require a flag on some Electron 35.x versions ([Issue #45532](https://github.com/electron/electron/issues/45532)). Pinned in `package.json` and documented in the setup steps below.

See [§4](./tech-stack.md#4-database-strategy-node-sqlite--raw-sql--zod) for the data-access pattern.

### Zod
Used pervasively: parsing MCP server config (Sources-tab JSON-paste mode), validating rule config before save, validating event payloads at the ingress, parsing DB rows into typed objects, and validating IPC messages crossing the main/renderer boundary. One validation library, everywhere.

### Fastify (event ingress)
The local HTTP listener (`127.0.0.1:PORT/event`) needs request validation and JSON parsing; Fastify gives both with Zod-compatible schemas and is lighter than Express. For a single-endpoint loopback listener this is arguably more than needed, but the request-validation discipline is worth the dependency. (`node:http` is the fallback if we want zero deps here.)

### electron-log
The main process needs structured, rotating file logs because observability is the safety net under auto-execute (no pre-write approval gate). [electron-log](https://github.com/megahertz/electron-log) is purpose-built: writes to `~/Library/Logs/<app>/` on macOS, rotates, and integrates with the main process cleanly.

### Vitest (unit) + Playwright (E2E)
The standard dual-stack. [Vitest](https://vitest.dev/) for unit-testing pure-logic modules (scheduler timing, concurrency queue, prompt builder, event matcher, config loader, status-block parser). [Playwright](https://playwright.dev/docs/api/class-electron) for E2E — its Electron support (`electron.launch()` + `electronApplication.evaluate()`) is the only realistic way to test the full scheduler→agent→MCP loop end-to-end. See [§5](./tech-stack.md#5-testing-strategy).

### ESLint + Prettier
Standard. `@typescript-eslint` for type-aware linting, React hooks plugin, Prettier for formatting. No controversy.

---

## 3. What we deliberately don't use

| Tool | Why not |
|---|---|
| **Electron Builder** | Forge is the official recommendation; mixing tools causes build-size and config headaches. |
| **electron-vite (standalone)** | Great dev experience but [recommends Forge for production](https://electron-vite.github.io/faq/electron-forge.html). Forge's Vite template gets us both. |
| **better-sqlite3 / sqlite3** | Native-module rebuild pain, ASAR config, `drizzle-kit` ABI mismatch — all eliminated by `node:sqlite`. |
| **Drizzle ORM / Prisma** | Schema is small (2 tables); raw SQL + Zod row validation covers our needs without the ORM overhead or the `drizzle-kit`-in-Electron friction. Can revisit if the schema grows. |
| **sql.js (WASM)** | In-memory with manual file persistence; wrong shape for write-heavy run logging. |
| **Redux / Redux Toolkit** | Overkill for a config + history UI. Zustand covers it. |
| **React Query / TanStack Query** | Data layer is synchronous IPC, not async REST. No benefit. |
| **Express** | Heavier than Fastify for a single-endpoint loopback listener; Fastify's Zod-native validation wins. |
| **Boilerplate starter kits** | Close to our stack but don't account for `node:sqlite`, native-module-free packaging, or Forge's config. Scaffold from Forge's Vite + React template and add pieces deliberately. |

---

## 4. Database strategy: `node:sqlite` + raw SQL + Zod

### Setup

`node:sqlite` is a built-in module — no install. On Electron 35+ it should work, but some 35.x versions need an enablement flag ([Issue #45532](https://github.com/electron/electron/issues/45532)). Verify with a smoke test on first run; if it fails, document the flag in the app's setup README.

```js
// src/main/db/client.ts
import { DatabaseSync } from 'node:sqlite';
import { app } from 'electron';
import path from 'node:path';

const dbPath = path.join(app.getPath('userData'), 'localcortex.db');
export const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
`);
```

### Migrations

Run via a standalone Node script at app startup — **not** via `drizzle-kit` (which has [`NODE_MODULE_VERSION` issues](https://github.com/WiseLibs/better-sqlite3/issues/1171) in Electron, and we don't use it anyway). Versioned `.sql` files applied in order, with a `schema_version` table tracking state.

```
src/main/db/migrations/
├── 001_initial.sql       ← rules, runs tables
├── 002_add_indexes.sql
└── ...
```

### Data-access pattern (no ORM)

Every query is raw SQL; every result row is parsed through a Zod schema to get a typed object. All DB access lives behind repository modules so the SQL never leaks into business logic.

```ts
// src/main/db/repositories/rules.ts
import { db } from '../client';
import { RuleSchema, type Rule } from '../../../shared/types';

const selectRule = db.prepare(`
  SELECT id, name, enabled, rule, trigger_json, mcp_servers_json,
         backend, workdir, sandbox, max_runs, expires_at, notes
  FROM rules WHERE id = ?
`);

export function getRule(id: string): Rule | null {
  const row = selectRule.get(id) as any;
  if (!row) return null;
  return RuleSchema.parse({
    ...row,
    trigger: JSON.parse(row.trigger_json),
    mcpServers: JSON.parse(row.mcp_servers_json),
    maxRuns: row.max_runs,
    expiresAt: row.expires_at,
  });
}
```

The Zod schemas double as the source of truth for TypeScript types (via `z.infer<>`), so the rule config, DB rows, and IPC messages all share one validation surface.

---

## 5. Testing strategy

### Unit tests (Vitest)

**The cardinal rule: factor pure logic out of Electron APIs.** Modules that import `electron` can't be unit-tested in plain Vitest (the `electron` module only exists inside a running Electron process). So:

- **Testable in plain Vitest** (pure TS, no `electron` import): scheduler timing math, concurrency queue, prompt builder, MCP config resolver, event matcher, status-block parser, Zod schemas, template-variable renderer.
- **Needs `electron` mocked:** IPC handlers, app bootstrap. Use `vi.mock('electron', ...)` at the top of the test file (not `vi.doMock` — see [Vitest Issue #4166](https://github.com/vitest-dev/vitest/issues/4166) for the caveat).

```ts
// Example: testing the event matcher (pure logic)
import { describe, it, expect } from 'vitest';
import { matchEventsToRules } from '../matcher';

describe('matchEventsToRules', () => {
  it('matches an event to a rule by eventType', () => {
    const rules = [{ trigger: { type: 'event', eventType: 'codex.session-complete' } }];
    const event = { type: 'codex.session-complete', workdir: '/x' };
    expect(matchEventsToRules(event, rules)).toHaveLength(1);
  });
});
```

### E2E tests (Playwright)

[Playwright's Electron API](https://playwright.dev/docs/api/class-electron) launches the real app and drives it. Use `electronApplication.evaluate()` to invoke main-process functions directly — this is how you test "scheduler fires → agent runs → MCP server spawns → status parsed" without a human in the loop.

- **Mock the agent backends** — never spawn real Claude/Codex in CI (slow, costly, non-deterministic). Inject a stub `AgentRunner` that returns canned transcripts.
- **Mock MCP upstreams** — run the real MCP server processes against fixture data, not live GitHub/GitLab.
- **Test the subprocess plumbing separately** from agent behavior — verify arg-building, stdio wiring, and teardown with a trivial echo server, not a real MCP server.

### What doesn't get automated
- Real agent reasoning quality (inherently non-deterministic; spot-check manually).
- Real OmniFocus/Todoist writes (need real accounts; test against a throwaway Todoist project).

---

## 6. Known gotchas (the ones that will actually cost time)

### 6.1 `node:sqlite` enablement on Electron 35
[Issue #45532](https://github.com/electron/electron/issues/45532) reports `node:sqlite` doesn't work out of the box on some Electron 35.x versions. **Mitigation:** smoke-test on first launch; if it throws, fall back to the `--experimental-sqlite` flag or document the required Electron version. Pin Electron in `package.json` to a known-good version.

### 6.2 Subprocess lifecycle (MCP servers, agent CLIs)
The app spawns child processes (MCP servers per run, Codex/Claude via SDK). Leaks here are subtle — a process that doesn't die holds credentials and resources. **Mitigation:** centralized lifecycle manager that tracks every spawned PID and kills them on run teardown and app quit. Test the teardown path specifically.

By default the SDKs spawn their own **bundled, vendored** native binary (resolved via `require.resolve` against a platform-specific npm package), so a globally installed `codex`/`claude` is ignored unless the user opts in via the `codexCliPath` / `claudeCliPath` Settings fields (see [architecture.md §6.5.1](./architecture.md#651-cli-resolution--local-vs-bundled-binary)). When set, that path is validated (exists + executable) on save and passed to the SDK as `codexPathOverride` / `pathToClaudeCodeExecutable`.

### 6.3 Codex MCP credentials pass as CLI args
Codex reads config only from `$CODEX_HOME` (`~/.codex/config.toml`), never from the workdir, so MCP servers are passed per-call via `--config key=value` flags. These flags include credential values (e.g. `mcp_servers.<name>.env.<TOKEN>=<value>`), which are visible in `ps`/process listings for the run's duration. **Trade-off:** this avoids writing a token-bearing file to disk (no teardown-leak risk), but exposes credentials on the command line, local to the user's own processes. Claude avoids this surface (servers passed as an in-memory `options.mcpServers` dict).

### 6.4 Local HTTP listener security
The event ingress is loopback-only but any process as the user can POST to it. **Mitigation:** bind strictly to `127.0.0.1`, optionally require a shared-secret token in the POST header (generated at app start, written to a `0600` file the hook scripts read), and log every received event.

### 6.5 App quit during a run
If the user quits mid-run, MCP servers and possibly the agent subprocess get orphaned. **Mitigation:** `app.on('before-quit')` handler that signals in-flight runs to abort, kills their subprocesses, and waits (with a timeout) before exiting.

### 6.6 Vitest + `electron` module
`vi.doMock('electron', ...)` [can return undefined exports](https://github.com/vitest-dev/vitest/issues/4166). **Mitigation:** use top-of-file `vi.mock`, or (better) structure code so the pure logic doesn't import `electron` at all.

---

## 7. Dependency map (`package.json`)

```jsonc
{
  "dependencies": {
    // Core runtime
    "electron": "^35",

    // Agent SDKs
    "@anthropic-ai/claude-agent-sdk": "latest",
    "@openai/codex-sdk": "latest",

    // Event ingress
    "fastify": "^5",

    // Renderer
    "react": "^19",
    "react-dom": "^19",
    "zustand": "^5",
    "tailwindcss": "^4",
    // shadcn/ui components added via CLI, not as a dependency

    // Cross-cutting
    "zod": "^3",
    "electron-log": "^5"

    // NOTE: no `better-sqlite3`, no `drizzle-orm`, no `sqlite3` —
    // node:sqlite is built into Node 22.14+ / Electron 35+.
  },
  "devDependencies": {
    // Build / package
    "@electron-forge/cli": "^7",
    "@electron-forge/plugin-vite": "^7",
    "@electron-forge/plugin-fuses": "^7",
    "@electron-forge/maker-dmg": "^7",
    "vite": "^6",
    "typescript": "^5",

    // Testing
    "vitest": "^2",
    "@playwright/test": "^1.49",

    // Lint / format
    "eslint": "^9",
    "@typescript-eslint/eslint-plugin": "^8",
    "@typescript-eslint/parser": "^8",
    "eslint-plugin-react-hooks": "^5",
    "prettier": "^3"
  }
}
```

Notable absences (deliberate):
- No `better-sqlite3` / `sqlite3` — using `node:sqlite`.
- No `drizzle-orm` / `drizzle-kit` / `prisma` — raw SQL + Zod.
- No `@electron/rebuild` — nothing native to rebuild.
- No `electron-builder` — using Forge.
- No `@tanstack/react-query` / `@reduxjs/toolkit` — Zustand + IPC.

---

## 8. Project scaffolding steps

1. `npx create-electron-app@latest localcortex -- --template=vite-typescript-react` (Forge's Vite + React + TS template).
2. Pin Electron to a version known to support `node:sqlite` cleanly; smoke-test `import { DatabaseSync } from 'node:sqlite'` in the main process on first run.
3. Add Tailwind 4 + shadcn/ui to the renderer (shadcn CLI).
4. Add Zustand.
5. Add Zod; define the shared types as Zod schemas (rule, event, mcp-server config, DB rows).
6. Set up the DB layer: `src/main/db/` with `client.ts`, migrations runner, and repository modules.
7. Add Fastify for the event ingress.
8. Add the agent SDKs; structure `src/main/agent/` with the `AgentRunner` interface and stub implementations.
9. Add Vitest + Playwright; write the first unit test (event matcher) and first E2E smoke test (app launches).
10. Add ESLint + Prettier.
11. Configure Forge makers for macOS `.dmg` + Developer ID signing (when ready to distribute).

---

## 9. Open tooling questions

- **`node:sqlite` stability timeline.** Watch the [Node stability scale](https://nodejs.org/api/sqlite.html) — once it hits "stable," the experimental caveat in §2 and §6.1 can be removed.
- **Drizzle `node:sqlite` support.** If Drizzle adds a first-class `node:sqlite` driver, we could adopt it for migrations and query-building without adopting a native module. Low priority — raw SQL + Zod is fine for the current schema size.
- **Auto-update strategy.** Forge integrates with `update.electronjs.org`. Decide whether v1 ships auto-update or requires manual download. Not a blocker for MVP.
- **CI.** GitHub Actions running Vitest (fast) on every push, Playwright E2E (slower) on PRs. Not yet configured.
