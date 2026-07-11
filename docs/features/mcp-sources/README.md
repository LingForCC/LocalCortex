# MCP Sources

LocalCortex reaches every external system — GitHub, GitLab, Todoist, OmniFocus, anything — through **MCP servers**. Rules reference servers **by name**; the actual spawn config (command, args, credentials) lives in the **`mcp_servers` DB table**, edited in-app through the Sources tab.

This is the same concept Claude Desktop and other MCP clients use: add or modify a server — no code change, no schema migration.

> Design: [mcp-servers.md](../../mcp-servers.md) is the authoritative format reference.

---

## The two components

| Component | Who edits | What it holds |
| --- | --- | --- |
| **`mcp_servers` DB table** | You (Sources tab) | name → spawn config (`command`, `args`, `env` with token values) |
| **Rule** | You | references server _names_ — nothing else |

There is no in-code registry and no separate credential store. The DB table is the single source of truth: it _is_ the registry and it _holds_ the credentials.

> **File → DB migration:** Previous versions stored MCP server configs in a static `~/.localcortex/mcp-servers.json` file. That file has been retired. On upgrade, a one-time import reads the legacy file and inserts its servers (preserving real tokens). If you have a pre-existing file, its contents are automatically imported on first launch.

---

## The server config shape

Each `mcp_servers` row holds:

| Field | Meaning |
| --- | --- |
| `name` | The server's unique name — any string you reference from rules. Primary key. |
| `transport` | `"stdio"` only in v1. |
| `command` | Executable to spawn. |
| `args` | Args for the executable (JSON array). |
| `env` | Env vars on the spawned process (JSON object). **Holds credentials as plaintext.** |
| `is_builtin` | `true` for seeded defaults (editable but not deletable). |

### Seeded defaults

Migration 004 seeds four servers on first run: `github`, `gitlab`, `todoist` (all with `<your-token-here>` placeholder tokens), and `omnifocus` (community JXA-based MCP server, no token required).

---

## Using the Sources view

The **Sources** tab provides full CRUD over the `mcp_servers` table with two input modes:

### Form mode

Field-by-field entry: name, command, args (one per line), env key/value rows. Good for manual configuration.

### JSON-paste mode

Paste the exact `{ "command", "args", "env" }` block — the same shape as a legacy file entry. This preserves the "paste a config snippet from an MCP server's README" workflow.

Both modes call `mcp-servers:upsert`. Builtin (seeded) servers are editable but not deletable. Servers still holding the `<your-token-here>` placeholder are flagged with a **Placeholder** badge so you know which ones need tokens.

---

## How rules resolve servers

When a rule runs, the run-loop reads the `mcp_servers` table via `McpServersRepository.getAsConfig()` (producing the same object shape the resolver has always consumed), then the lifecycle manager resolves each name in `rule.mcpServers`:

```
for each name in rule.mcpServers:
  1. look up the server by name in mcp_servers
     → if missing: run fails fast ("server 'X' is not defined")
  2. copy out { command, args, env } (deep copy — caller may mutate)
  3. if any env value is still "<your-token-here>":
     → run fails fast ("set real tokens for 'X'")
```

The resolved config is then serialized per backend: Claude gets it as `options.mcpServers` (per-call); Codex gets it as `options.config`, flattened into `--config` flags (per-call). See [Agent backends](../agent-backends/README.md). This serialization logic is **unchanged** — it operates on the same config object shape regardless of source.

### Why `mcpServers` is the only structural selector
Function-calling models degrade as the tool list grows. With six configured servers, spawning all of them every run means the agent sees 60–120 tools and starts calling the wrong server or hallucinating tools. Curating the toolset per rule keeps the agent accurate and bounds the **credential blast radius** — a rule can only touch the systems its servers connect to.

---

## Adding a new server (no code change)

1. **Sources** tab → "Add server" → choose Form or JSON mode:
   - **Form:** fill in name, command, args (one per line), env key/value rows.
   - **JSON:** paste:
     ```jsonc
     {
       "command": "npx",
       "args": ["-y", "@modelcontextprotocol/server-jira"],
       "env": { "JIRA_API_TOKEN": "...", "JIRA_HOST": "acme.atlassian.net", "JIRA_EMAIL": "you@acme.com" }
     }
     ```
     and set the name (e.g. `jira-acme`).
2. Reference the name from any rule: `"mcpServers": ["jira-acme", "todoist"]`.
3. Run the rule.

### Multiple accounts for one upstream
Define two entries (`github-personal`, `github-work`) pointing at different tokens, and pick per rule. Names are arbitrary aliases.

---

## Security notes

- **Tokens are plaintext** in the SQLite DB (Electron's userData directory). This is the same posture as the previous 0600 file — anyone with read access to your user account (malware as you, backups, accidental sharing) can read them. See [design: security notes §8](../../mcp-servers.md#8-security-notes).
- **Credentials reach servers only at spawn time** as process env. Not retained in app memory beyond the run.
- **Per-run respawn** — each server process lives only for one agent run. No long-lived process holds credentials.
- **Codex passes tokens as CLI args** (`--config mcp_servers.<name>.env.<TOKEN>=<value>`), visible in `ps` during the run. No token file is written to disk. Claude passes servers as an in-memory dict, never on the command line.

## Gotchas
- **Saving a rule ≠ its servers are ready.** A rule referencing an undefined server saves fine but fails at run time. Use the Sources tab or a run attempt to surface the error.
- **`npx -y` fetches latest** on each spawn. Pin exact versions in `args` (e.g. `@modelcontextprotocol/server-github@1.2.3`) for reproducibility / supply-chain safety.
- **Hot reload** — editing servers in the Sources tab takes effect on the _next_ run (the run-loop reads the DB per run). No restart needed.

## Related
- [Rules](../rules/README.md) — the `mcpServers` field.
- [Handoff setup](../handoff-setup/README.md) — the first-run wizard that uses the catalog.
- [Agent backends](../agent-backends/README.md) — how servers are attached per backend.
- [design: mcp-servers.md](../../mcp-servers.md) — full format, default config, resolution algorithm.
