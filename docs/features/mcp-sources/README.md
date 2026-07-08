# MCP Sources

LocalCortex reaches every external system — GitHub, GitLab, Todoist, OmniFocus, anything — through **MCP servers**. Rules reference servers **by name**; the actual spawn config (command, args, credentials) lives in one user-editable file: `~/.localcortex/mcp-servers.json`.

This is the same model Claude Desktop and other MCP clients use: add or modify a server by editing the file — no code change, no schema migration.

> Design: [mcp-servers.md](../../mcp-servers.md) is the authoritative format reference.

---

## The two components

| Component | Who edits | What it holds |
| --- | --- | --- |
| **Config file** `~/.localcortex/mcp-servers.json` | You | name → spawn config (`command`, `args`, `env` with token values) |
| **Rule** | You | references server _names_ — nothing else |

There is no in-code registry and no separate credential store. The file is the single source of truth: it _is_ the registry and it _holds_ the credentials.

---

## The config file

```jsonc
// ~/.localcortex/mcp-servers.json
{
  "servers": {
    "github-personal": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_abc123..." }
    },
    "github-work": {                                    // two accounts — same upstream, different token
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_def456..." }
    },
    "gitlab": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-gitlab"],
      "env": {
        "GITLAB_PERSONAL_ACCESS_TOKEN": "glpat-xyz789...",
        "GITLAB_API_URL": "https://gitlab.example.com/api/v4"   // self-hosted
      }
    },
    "todoist": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@abhiz123/todoist-mcp-server"],
      "env": { "TODOIST_API_TOKEN": "tod_abc123..." }
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| `servers.<name>` | One server. `<name>` is arbitrary — any string you want to reference from rules. |
| `transport` | `"stdio"` only in v1. |
| `command` | Executable to spawn. |
| `args` | Args for the executable. |
| `env` | Env vars on the spawned process. **Holds credentials as plaintext.** |

### First launch
If the file doesn't exist, the app writes a **default** containing the three v1 servers (`github`, `gitlab`, `todoist`) with `<your-token-here>` placeholders. The file is created with **`0600`** permissions (owner read/write only).

---

## Using the Sources view

The **Sources** tab surfaces the config file's contents without requiring you to open a terminal:

- **MCP servers** — chips for each configured server name. Servers still holding the `<your-token-here>` placeholder are flagged with **· placeholder**.
- **Raw config** — the full JSON, for reference or copy-paste.
- **Refresh** — re-reads the file (use after editing it in an external editor).

Editing the file itself happens in your editor of choice (the app doesn't write tokens back — it only writes the default on first launch). After editing, click **Refresh**.

---

## How rules resolve servers

When a rule runs, the lifecycle manager resolves each name in `rule.mcpServers`:

```
for each name in rule.mcpServers:
  1. look up config.servers[name]
     → if missing: run fails fast ("server 'X' is not defined in mcp-servers.json")
  2. copy out { command, args, env } (deep copy — caller may mutate)
  3. if any env value is still "<your-token-here>":
     → run fails fast ("edit mcp-servers.json and set the token for 'X'")
```

The resolved config is then serialized per backend: Claude gets it as `options.mcpServers` (per-call); Codex gets it as `options.config`, flattened into `--config` flags (per-call). See [Agent backends](../agent-backends/README.md).

### Why `mcpServers` is the only structural selector
Function-calling models degrade as the tool list grows. With six configured servers, spawning all of them every run means the agent sees 60–120 tools and starts calling the wrong server or hallucinating tools. Curating the toolset per rule keeps the agent accurate and bounds the **credential blast radius** — a rule can only touch the systems its servers connect to.

---

## Adding a new server (no code change)

1. Add an entry under `servers` in `~/.localcortex/mcp-servers.json`:
   ```jsonc
   "jira-acme": {
     "transport": "stdio",
     "command": "npx",
     "args": ["-y", "@modelcontextprotocol/server-jira"],
     "env": { "JIRA_API_TOKEN": "...", "JIRA_HOST": "acme.atlassian.net", "JIRA_EMAIL": "you@acme.com" }
   }
   ```
2. Reference the name from any rule: `"mcpServers": ["jira-acme", "todoist"]`.
3. Run the rule.

### Multiple accounts for one upstream
Define two entries (`github-personal`, `github-work`) pointing at different tokens, and pick per rule. Names are arbitrary aliases.

---

## Security notes

- **Tokens are plaintext** in the file. Anyone with read access to your home directory (malware as you, backups, accidental sharing) can read them. Mitigation: `0600` perms (applied on first launch); store the file on an encrypted volume if you need more. See [design: security notes §8](../../mcp-servers.md#8-security-notes).
- **Credentials reach servers only at spawn time** as process env. Not retained in app memory beyond the run.
- **Per-run respawn** — each server process lives only for one agent run. No long-lived process holds credentials.
- **Codex passes tokens as CLI args** (`--config mcp_servers.<name>.env.<TOKEN>=<value>`), visible in `ps` during the run. No token file is written to disk. Claude passes servers as an in-memory dict, never on the command line.
- **Never commit the file.** It's gitignored. Distribute tokens out of band.

## Gotchas
- **Saving a rule ≠ its servers are ready.** A rule referencing an undefined server saves fine but fails at run time. Use the Sources tab or a run attempt to surface the error.
- **`npx -y` fetches latest** on each spawn. Pin exact versions in `args` (e.g. `@modelcontextprotocol/server-github@1.2.3`) for reproducibility / supply-chain safety (v1.1+).
- **Hot reload** — editing the file takes effect on the _next_ run (the app reads it per run). No restart needed.

## Related
- [Rules](../rules/README.md) — the `mcpServers` field.
- [Agent backends](../agent-backends/README.md) — how servers are attached per backend.
- [design: mcp-servers.md](../../mcp-servers.md) — full format, default config, resolution algorithm.
