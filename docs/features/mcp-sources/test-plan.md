# MCP Sources — Test Plan

Covers the **DB-backed `mcp_servers` table** (replacing the former config file),
**CRUD operations**, **legacy file import**, **name resolution**, **per-backend
serialization** (Claude + Codex TOML), and **placeholder-token detection**.

---

## In scope

- `McpServersRepository`: seeding, CRUD (upsert/delete), `getAsConfig()`, placeholder detection, legacy `importFromFile`.
- `parseConfigFile` (retained for legacy import).
- `resolveMcpServers` (name → spawn config; undefined-name error).
- `serializeForClaude` / `serializeForCodex` / `serializeForCodexConfig` (+ placeholder check).
- `servers:list` / `servers:read` / `servers:validate` IPC handlers.
- `mcp-servers:list/get/upsert/delete` catalog IPC handlers.

## Out of scope (covered elsewhere)

- Actually spawning MCP server processes → exercised only via real agent runs (see [Agent backends](../agent-backends/test-plan.md)).
- Onboarding wizard interactions with the catalog → [Handoff setup](../handoff-setup/test-plan.md).

---

## Test types

| Type | Tool | Where |
| --- | --- | --- |
| Unit (pure logic + temp DB) | Vitest | `src/**/*.test.ts` |
| E2E (Electron) | Playwright | `playwright/*.spec.ts` |
| Manual | operator | — |

---

## Unit tests

### `mcp_servers` repository — `src/main/db/repositories/mcp-servers.ts`
**Status:** ✅ covered — `src/main/db/repositories/mcp-servers.test.ts` (10 cases).

| # | Case | Expected |
| --- | --- | --- |
| M-R1 | seeds v1 defaults on migration | github, gitlab, todoist, omnifocus present ✅ new |
| M-R2 | marks seeded servers as builtin | `isBuiltin === true` ✅ new |
| M-R3 | seeds placeholder tokens for github/gitlab/todoist (not omnifocus) | `placeholderNames()` includes the three; excludes omnifocus ✅ new |
| M-R4 | upserts a new server | row created + retrievable ✅ new |
| M-R5 | upsert overwrites an existing server | all fields updated; env replaced ✅ new |
| M-R6 | deletes a server | row removed; `getByName` returns null ✅ new |
| M-R7 | `getAsConfig` returns a McpServersFile-shaped object | resolver-compatible `{ servers: { … } }` ✅ new |
| M-R8 | `getAsConfig` includes custom servers added via upsert | upserted server visible in config ✅ new |
| M-R9 | legacy import: overwrites seeds with real tokens, adds custom server, idempotent | tokens replaced; placeholder cleared; custom added; re-import = same count ✅ new |
| M-R10 | legacy import: returns 0 for missing or malformed file | seeds intact; no throw ✅ new |

### Resolver — `resolveMcpServers` (`src/main/mcp/resolver.ts`)
**Status:** ✅ covered — `src/main/mcp/resolver.test.ts` (5 cases, unchanged; accepts the DB-sourced shape).

| # | Case | Expected |
| --- | --- | --- |
| M-V1 | resolves each referenced name to a deep copy of its spawn config | `{ command, args, env }` per name ✅ existing |
| M-V2 | returns independent copies (mutation does not leak to source config) | mutating resolved env doesn't change the config ✅ existing |
| M-V3 | throws `UndefinedMcpServerError` naming the missing server + rule | error message includes server name and rule id ✅ existing |
| M-V4 | resolves zero servers for an empty `mcpServers` array | `{}` (empty resolved map) ✅ existing |
| M-V5 | `listServerNames` returns the names defined in the config | `Object.keys(config.servers)` ✅ existing |

### Serializer — `serializeForClaude` (`src/main/mcp/config.ts`)
**Status:** ✅ covered — `src/main/mcp/config.test.ts` → `serializeForClaude` suite (2 cases, unchanged).

| # | Case | Expected |
| --- | --- | --- |
| M-S1 | produces the Claude `options.mcpServers` shape | `{ type: 'stdio', command, args, env }` per server ✅ existing |
| M-S2 | returns independent copies (mutating output doesn't touch input) | pushing to output args doesn't change source ✅ existing |

### Serializer — `serializeForCodex` / `serializeForCodexConfig` (`src/main/mcp/config.ts`)
**Status:** ✅ covered — `src/main/mcp/config.test.ts` → `serializeForCodex` + `serializeForCodexConfig` suites (7 cases, unchanged).

| # | Case | Expected |
| --- | --- | --- |
| M-S3 | `serializeForCodex` emits `[mcp_servers."name"]` tables with command/args/env | TOML contains the table headers + values ✅ existing |
| M-S4 | `serializeForCodex` omits the env table when env is empty | TOML does not contain `.env]` ✅ existing |
| M-S5 | `serializeForCodex` escapes quotes and backslashes in values | `a"b\c` → `a\"b\\c` in TOML ✅ existing |
| M-S6 | `serializeForCodex` quotes bare-unsafe env keys (e.g. `dotted.key`) | `"dotted.key" = "v"` ✅ existing |
| M-S7 | `serializeForCodexConfig` nests servers under `mcp_servers` with command/args/env + `default_tools_approval_mode: 'approve'` | pre-approved tools config shape ✅ existing |
| M-S8 | `serializeForCodexConfig` returns an empty env object (not omitted) for servers with no env | `env: {}` present in output ✅ existing |
| M-S9 | `serializeForCodexConfig` returns independent copies (mutating output does not touch input) | pushing to output args doesn't change source ✅ existing |

### Placeholder check — `serversWithPlaceholder` / `assertNoPlaceholders` (`src/main/mcp/config.ts`)
**Status:** ✅ covered — `src/main/mcp/config.test.ts` → placeholder suite (3 cases, unchanged).

| # | Case | Expected |
| --- | --- | --- |
| M-P1 | `serversWithPlaceholder` lists servers whose env is still `<your-token-here>` | returns `['a']` for `{ a: { env: { T: '<your-token-here>' } }, b: { env: { T: 'real' } } }` ✅ existing |
| M-P2 | `assertNoPlaceholders` throws `PlaceholderTokenError` listing all offenders | error names all offending servers ✅ existing |
| M-P3 | `assertNoPlaceholders` passes when all tokens are real | does not throw ✅ existing |

### Legacy config parser — `parseConfigFile` (`src/main/mcp/config-loader.ts`)
**Status:** ✅ covered — `src/main/mcp/config-loader.test.ts` (4 cases, parse-only — file I/O retired).

| # | Case | Expected |
| --- | --- | --- |
| M-L1 | parses a well-formed config | `servers['gh'].command === 'npx'` ✅ existing |
| M-L2 | applies defaults for missing `args`/`env` | `args === []`, `env === {}` ✅ existing |
| M-L3 | throws on invalid JSON | error matches `/not valid JSON/` ✅ existing |
| M-L4 | throws on a schema violation (non-stdio transport) | parse rejects ✅ existing |

---

## IPC handlers — `src/main/ipc/servers.ts` + `src/main/ipc/catalog.ts`
**Status:** not unit-tested (Electron-coupled). Verify via E2E/manual.

| # | Case | Expected |
| --- | --- | --- |
| M-I1 | `servers:list` returns names + placeholders | `{ names, placeholders }` |
| M-I2 | `servers:read` returns the config object | McpServersFile shape |
| M-I3 | `servers:validate` flags a rule referencing an undefined server | `{ ok:false, errors:[...] }` |
| M-I4 | `mcp-servers:upsert` creates/updates a server | row persisted |
| M-I5 | `mcp-servers:delete` removes a non-builtin server | row removed |

---

## E2E (Playwright)

**Status:** ✅ covered — `playwright/sources.spec.ts` (4 cases) on the shared isolation fixture.

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| M-E1 | Sources view lists servers + flags placeholders | Complete onboarding → open Sources tab | github/gitlab/todoist flagged as Placeholder; omnifocus not ✅ existing |
| M-E2 | Form mode: add a server | Add server → Form → fill name/command/args/env → Save | server appears in list ✅ existing |
| M-E3 | JSON-paste mode: add a server | Add server → JSON → paste `{ command, args, env }` → Save | server parsed and persisted ✅ existing |
| M-E4 | Edit a builtin server (update token) | Edit github → replace placeholder token → Save | token updated (verified via IPC) ✅ existing |

---

## Manual test plan

Run after any change to the `mcp_servers` repository, the resolver, the
serializers, or the Sources UI.

1. **Legacy import on upgrade.** Place a pre-existing `~/.localcortex/mcp-servers.json` with real tokens (not placeholders). Launch the app. Confirm the servers are imported (tokens preserved, placeholders overwritten) and visible in the Sources tab. Confirm the file is no longer needed after import — the DB is the single source of truth.
2. **Malformed legacy file.** Place a syntactically invalid `mcp-servers.json` (e.g. `{ not json`). Launch the app. Confirm the import returns 0, the seeded defaults are intact, and the app doesn't crash.
3. **Add a server + reference it in a rule.** Sources tab → add a server (e.g. `jira-acme` with a real token). Create or edit a rule referencing `mcpServers: ["jira-acme"]`. Run the rule. Confirm the agent can call that server's tools (status `error` is acceptable if the token is fake — the point is that resolution + serialization succeed).
4. **Placeholder rejection at run time.** Create a rule referencing a server still holding `<your-token-here>`. Run it. Confirm the run fails fast with a clear "set real tokens" message, not a cryptic MCP auth error.
5. **Delete a custom server.** Add a custom server, then delete it. Confirm the row is removed. Confirm a builtin server cannot be deleted (the Delete button is absent).
6. **Hot reload.** Edit a server's token in the Sources tab. Without restarting the app, run a rule that references it. Confirm the run uses the updated token (the run-loop reads the DB per run).
7. **Multiple accounts for one upstream.** Add two servers (`github-personal`, `github-work`) with different tokens. Reference each from a different rule. Confirm both resolve to the correct token.

---

## Related
- [MCP sources README](./README.md) — authoritative config-format reference.
- [Handoff setup test plan](../handoff-setup/test-plan.md) (onboarding wizard interactions with the catalog)
