# MCP Sources — Test Plan

Covers the **DB-backed `mcp_servers` table** (replacing the former config file),
**CRUD operations**, **legacy file import**, **name resolution**, **per-backend
serialization** (Claude + Codex TOML), and **placeholder-token detection**.

---

## In scope
- `McpServersRepository`: seeding, CRUD (upsert/delete), `getAsConfig()`, placeholder detection, legacy `importFromFile`.
- `parseConfigFile` (retained for legacy import).
- `resolveMcpServers` (name → spawn config; undefined-name error).
- `serializeForClaude` / `serializeForCodex` (+ placeholder check).
- `servers:list` / `servers:read` / `servers:validate` IPC handlers.
- `mcp-servers:list/get/upsert/delete` catalog IPC handlers.

## Out of scope
- Actually spawning MCP server processes → exercised only via real agent runs (see [Agent backends](../agent-backends/test-plan.md)).

---

## Unit tests

### `mcp_servers` repository — `src/main/db/repositories/mcp-servers.test.ts`
**Status:** ✅ covered — 10 cases.

| # | Case | Expected |
| --- | --- | --- |
| M-R1 | seeds v1 defaults on migration | github, gitlab, todoist, omnifocus present |
| M-R2 | marks seeded servers as builtin | `isBuiltin === true` |
| M-R3 | seeds placeholder tokens for github/gitlab/todoist | placeholderNames includes them; not omnifocus |
| M-R4 | upserts a new server | row created + retrievable |
| M-R5 | upsert overwrites an existing server | fields updated |
| M-R6 | deletes a server | row removed |
| M-R7 | `getAsConfig` returns McpServersFile-shaped object | resolver-compatible shape |
| M-R8 | `getAsConfig` includes custom servers | upserted server visible |
| M-R9 | legacy import: overwrites seeds with real tokens | placeholder cleared, custom server added, idempotent |
| M-R10 | legacy import: returns 0 for missing/malformed file | seeds intact |

### Resolver — `src/main/mcp/resolver.test.ts`
**Status:** ✅ covered — 5 cases (unchanged; accepts the DB-sourced shape).

### Serializer + placeholder check — `src/main/mcp/config.test.ts`
**Status:** ✅ covered — 12 cases (unchanged logic).

### Legacy config parser — `src/main/mcp/config-loader.test.ts`
**Status:** ✅ covered — 4 cases (parse-only, retained for import).

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

## E2E / Manual

**Status:** ✅ covered — `playwright/sources.spec.ts` (4 automated cases), plus manual scenarios.

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| M-E1 | Sources view lists servers + flags placeholders | Open Sources tab (after onboarding) | servers shown, placeholders flagged ✅ existing |
| M-E2 | Form mode: add a server | Add server (form) → fill → Save | server appears in list ✅ existing |
| M-E3 | JSON-paste mode: add a server | Add server (JSON) → paste block → Save | server parsed and persisted ✅ existing |
| M-E4 | Edit a builtin server | Edit github → change token → Save | token updated (verified via IPC) ✅ existing |
| M-E5 | Legacy import on upgrade | Place a real `mcp-servers.json` → launch app | servers imported with tokens preserved — **manual** |
| M-E6 | Adding a server + referencing it in a rule works | Add server, reference in rule, run | agent can call that server's tools — **manual** |

---

## Related
- [MCP sources README](./README.md)
- [Handoff setup README](../handoff-setup/README.md)
- [design: mcp-servers.md](../../mcp-servers.md)
