# MCP Sources — Test Plan

Covers the **config-file loader**, **name resolution**, **per-backend serialization** (Claude + Codex TOML), **placeholder-token detection**, and the **default-config provisioning** on first launch.

---

## In scope
- `parseConfigFile` / `loadMcpServersFile` / `ensureConfigFile` (read, validate, first-launch write).
- `resolveMcpServers` (name → spawn config; undefined-name error).
- `serializeForClaude` / `serializeForCodex` (+ placeholder check).
- The bundled default config content.
- `servers:list` / `servers:validate` IPC handlers.

## Out of scope
- Actually spawning MCP server processes → exercised only via real agent runs (see [Agent backends](../agent-backends/test-plan.md)).

---

## Test types
| Type | Tool | Where |
| --- | --- | --- |
| Unit (pure logic + temp FS) | Vitest | `src/**/*.test.ts` |
| E2E | Playwright (Sources view) | `playwright/sources.spec.ts` |
| Manual | operator | — |

---

## Unit tests

### Config loader — `src/main/mcp/config-loader.test.ts`
**Status:** ✅ covered — 10 cases.

| # | Case | Expected |
| --- | --- | --- |
| M-L1 | parses well-formed config | ✅ existing |
| M-L2 | applies defaults for missing `args`/`env` | ✅ existing |
| M-L3 | rejects invalid JSON | ✅ existing |
| M-L4 | rejects non-stdio transport (schema violation) | ✅ existing |
| M-L5 | round-trips serialize ↔ parse | ✅ existing |
| M-L6 | `loadMcpServersFile` returns null when absent | ✅ existing |
| M-L7 | `loadMcpServersFile` loads + parses existing file | ✅ existing |
| M-L8 | `ensureConfigFile` writes default with `0600` perms | ✅ existing |
| M-L9 | `ensureConfigFile` does not overwrite existing | ✅ existing |
| M-L10 | `ensureConfigFile` is idempotent | ✅ existing |

### Resolver — `src/main/mcp/resolver.test.ts`
**Status:** ✅ covered — 5 cases.

| # | Case | Expected |
| --- | --- | --- |
| M-R1 | resolves each name to a deep copy | ✅ existing |
| M-R2 | mutation does not leak to source config | ✅ existing |
| M-R3 | throws `UndefinedMcpServerError` naming server + rule | ✅ existing |
| M-R4 | empty `mcpServers` → empty resolved | ✅ existing |
| M-R5 | `listServerNames` returns defined names | ✅ existing |

### Serializer + placeholder check — `src/main/mcp/config.test.ts`
**Status:** ✅ covered — 10 cases.

| # | Case | Expected |
| --- | --- | --- |
| M-S1 | `serializeForClaude` produces `options.mcpServers` shape | ✅ existing |
| M-S2 | Claude output is a deep copy | ✅ existing |
| M-S3 | `serializeForCodex` emits `[mcp_servers."name"]` + tables + `approval_policy="never"` | ✅ existing |
| M-S4 | Codex omits env table when env empty | ✅ existing |
| M-S5 | Codex escapes quotes/backslashes in values | ✅ existing |
| M-S6 | Codex quotes bare-unsafe env keys (e.g. `dotted.key`) | ✅ existing |
| M-S7 | Codex honors custom approval policy | ✅ existing |
| M-S8 | `serversWithPlaceholder` lists offenders | ✅ existing |
| M-S9 | `assertNoPlaceholders` throws listing offenders | ✅ existing |
| M-S10 | `assertNoPlaceholders` passes when all tokens real | ✅ existing |

### Default config — `src/main/mcp/default-config.ts`
**Status:** partially covered (M-L8 asserts the three names + placeholder). **Add:**

| # | Case | Expected |
| --- | --- | --- |
| M-D1 | default contains exactly `github`, `gitlab`, `todoist` | (covered via M-L8) |
| M-D2 | `gitlab.env.GITLAB_API_URL` defaults to `https://gitlab.com/api/v4` | **add** |

---

## IPC handlers — `src/main/ipc/servers.ts`
**Status:** not unit-tested (Electron-coupled). Verify via E2E/manual.

| # | Case | Expected |
| --- | --- | --- |
| M-I1 | `servers:list` returns names + placeholders | `{ names, placeholders }` |
| M-I2 | `servers:read` returns the parsed file | config object |
| M-I3 | `servers:validate` flags a rule referencing an undefined server | `{ ok:false, errors:[...] }` |
| M-I4 | `servers:validate` flags a placeholder token in a used server | error mentions the rule + server |
| M-I5 | `servers:validate` passes when all good | `{ ok:true, errors:[] }` |
| M-I6 | missing config file → `servers:list` returns empty | `{ names:[], placeholders:[] }` |

---

## E2E / Manual

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| M-E1 | Sources view lists servers + flags placeholders | Open Sources tab before filling tokens | chips show "· placeholder" ✅ existing (`playwright/sources.spec.ts`) |
| M-E2 | Refresh picks up edits | Edit file externally; click Refresh | updated list/raw config ✅ existing (`playwright/sources.spec.ts`) |
| M-E3 | Adding a new server + referencing it works | Add `jira-acme`, reference in a rule, run | agent can call jira tools — **manual** (needs a live agent run) |
| M-E4 | First-launch provisioning | delete `~/.localcortex/mcp-servers.json`, relaunch app | file recreated with `0600` perms ✅ existing (`playwright/sources.spec.ts`) |

---

## Related
- [MCP sources README](./README.md)
- [design: mcp-servers.md](../../mcp-servers.md)
