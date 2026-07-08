# MCP Servers

This document specifies how LocalCortex resolves a rule's `mcpServers` names (e.g. `["github-personal", "todoist"]`) into concrete MCP server configurations that the agent SDK can spawn.

Rules reference servers **by name only** (see [rule-config-schema.md §7](./rule-config-schema.md#7-mcpservers--which-mcp-servers-to-attach)). Each name resolves through a **user-editable config file** at `~/.localcortex/mcp-servers.json`. The file holds the full spawn config for each server — command, args, and credentials (as plaintext env values). The app loads it at startup and looks servers up by name at run time.

This is the same model Claude Desktop and other MCP clients use. Users add or modify servers by editing the file; the app never needs a code change to support a new server.

---

## 1. The two components

| Component | Who edits | What it holds |
|---|---|---|
| **Config file** `~/.localcortex/mcp-servers.json` | User | Maps a name → full spawn config: `command`, `args`, `env` (including token values) |
| **Rule** | User | References server names — nothing else |

There is no in-code server registry and no separate credential store. The file is the single source of truth: it *is* the registry, and it *holds* the credentials.

A bundled **default config** (§3) is written to the path on first launch so the four v1 servers work out of the box; the user then edits it to put in real tokens or add servers.

---

## 2. Config file format

```jsonc
// ~/.localcortex/mcp-servers.json
{
  "servers": {
    "github-personal": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_abc123..."
      }
    },
    "github-work": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_def456..."
      }
    },
    "gitlab": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-gitlab"],
      "env": {
        "GITLAB_PERSONAL_ACCESS_TOKEN": "glpat-xyz789...",
        "GITLAB_API_URL": "https://gitlab.example.com/api/v4"
      }
    },
    "todoist": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@abhiz123/todoist-mcp-server"],
      "env": {
        "TODOIST_API_TOKEN": "tod_abc123..."
      }
    },
    "omnifocus": {
      "transport": "stdio",
      "command": "node",
      "args": ["<app-bundle>/sinks/omnifocus-jxa/dist/index.js"],
      "env": {}
    }
  }
}
```

### Field semantics

| Field | Type | Meaning |
|---|---|---|
| `servers.<name>` | object | One server definition. `<name>` is arbitrary — any string the user wants to reference from rules. |
| `transport` | `"stdio"` | MCP transport. Only `"stdio"` is used in v1 (external servers, respawned per run — see [architecture.md §5.2, §5.4](./architecture.md#52-write-hosting--external-stdio-servers-uniformly)). HTTP/SSE deferred. |
| `command` | string | Executable to spawn. |
| `args` | string[] | Args passed to the executable. |
| `env` | object | Env vars set on the spawned process. **Holds credential values as plaintext.** Keys are whatever the server package expects (e.g., `GITHUB_PERSONAL_ACCESS_TOKEN`). |

### Notes on the format

- **Names are arbitrary.** Unlike a fixed union type, `McpServerName` is just `string`. A user can define two GitHub entries (`github-personal`, `github-work`) pointing at different tokens, or alias a server under a friendly name.
- **Multiple env vars are fine.** The GitLab entry above sets both a token and a custom API URL — useful for self-hosted GitLab.
- **Credentials are plaintext.** Tokens are written directly into the `env` object. This is a deliberate trade-off for simplicity and self-containment — see §6.
- **The OmniFocus entry points into the app bundle.** Its `command`/`args` are written by the app on first launch (the path depends on the install location), and the user generally doesn't edit it. It has an empty `env` because the JXA wrapper talks to the local OmniFocus app, not an API.

---

## 3. Default config (shipped)

On first launch, if `~/.localcortex/mcp-servers.json` does not exist, the app writes a default containing the four v1 servers with **empty token placeholders**:

```jsonc
{
  "servers": {
    "github": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "<your-token-here>" }
    },
    "gitlab": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-gitlab"],
      "env": {
        "GITLAB_PERSONAL_ACCESS_TOKEN": "<your-token-here>",
        "GITLAB_API_URL": "https://gitlab.com/api/v4"
      }
    },
    "todoist": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@abhiz123/todoist-mcp-server"],
      "env": { "TODOIST_API_TOKEN": "<your-token-here>" }
    },
    "omnifocus": {
      "transport": "stdio",
      "command": "node",
      "args": ["<resolved-at-first-launch>"],
      "env": {}
    }
  }
}
```

The user replaces `<your-token-here>` with real values. The app validates at run time that no placeholder tokens remain in servers a rule actually uses (§5).

---

## 4. Resolution algorithm

The lifecycle manager resolves a rule's server names as follows:

```
input:  rule.mcpServers (e.g., ["github-personal", "todoist"])
        config = load("~/.localcortex/mcp-servers.json")

for each serverName in rule.mcpServers:
  1. def = config.servers[serverName]
     if missing → error: "server 'X' is not defined in mcp-servers.json"
  2. resolved[serverName] = {
       transport: def.transport,
       command:   def.command,
       args:      [...def.args],
       env:       { ...def.env }
     }

output: resolved — a dict of serverName → concrete spawn config
```

This `resolved` dict is then serialized per backend (§5).

### Why this design

- **One source of truth.** The file *is* the registry — there's no separate credential store to keep in sync, no positional binding to compute, no `safeStorage` round-trip.
- **Names are the only contract with rules.** Users write `"github-personal"` in a rule; the file says what that means. Changing a token or pointing at a different account is a file edit, not a rule edit.
- **Open-ended on servers.** Adding a Jira source or a Linear sink is a file edit, not a code change or schema migration.
- **Self-documenting.** A user's `mcp-servers.json` fully describes their MCP setup; sharing or backing it up is one file. (Caveat: it contains plaintext tokens — see §6.)

---

## 5. Serialization per backend

The resolved config is identical in substance for both backends; only the SDK's expected format differs. This is the whole job of `src/main/mcp/config.ts`.

### 5.1 Claude Agent SDK — `options.mcpServers`

Claude accepts MCP servers **per-call** as a dict on `query()` options (see [architecture.md §5.5](./architecture.md#55-mcp-config-asymmetry-between-backends)):

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

query({
  prompt: "...",
  options: {
    cwd: rule.workdir,
    mcpServers: {
      "github-personal": {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_abc123..." },
      },
      "todoist": {
        type: "stdio",
        command: "npx",
        args: ["-y", "@abhiz123/todoist-mcp-server"],
        env: { TODOIST_API_TOKEN: "tod_abc123..." },
      },
    },
  },
});
```

### 5.2 Codex SDK — per-call `options.config` (`--config` flags)

Codex reads its config **only from `$CODEX_HOME` (`~/.codex/config.toml`)**, never from the working directory — so a per-run `.codex/config.toml` written into the workdir would be ignored. Instead the resolved servers are passed **per-call** via the SDK's `options.config`. The SDK flattens that object into repeated `--config key=value` CLI flags, layered on top of the user's global `~/.codex/config.toml`:

```bash
codex exec \
  --config 'mcp_servers.github-personal.command="npx"' \
  --config 'mcp_servers.github-personal.args=["-y","@modelcontextprotocol/server-github"]' \
  --config 'mcp_servers.github-personal.env.GITHUB_PERSONAL_ACCESS_TOKEN="ghp_abc123..."' \
  --config 'mcp_servers.todoist.command="npx"' \
  --config 'mcp_servers.todoist.args=["-y","@abhiz123/todoist-mcp-server"]' \
  --config 'mcp_servers.todoist.env.TODOIST_API_TOKEN="tod_abc123..."' \
  ...
```

`approval_policy` is not part of this servers config — it's set via the `approvalPolicy: 'never'` ThreadOption, which the SDK emits as its own `--config` flag. Nothing is written to disk, so there is no token-bearing file to clean up at teardown.

### 5.3 Placeholder validation

Before spawning, the lifecycle manager checks that no env value in a resolved server is still a `<your-token-here>` placeholder. If a rule references a server whose token hasn't been filled in, the run fails fast with a clear message ("edit mcp-servers.json and set the token for 'github-personal'") rather than a cryptic MCP auth error.

---

## 6. Worked example, end to end

Given this rule (see [rule-config-schema.md](./rule-config-schema.md)):

```jsonc
{
  "rule": "Fetch open PRs assigned to me in acme/web-app. For any in review >24h without approval, create a Todoist task under 'Engineering'.",
  "mcpServers": ["github-personal", "todoist"]
}
```

And this config file:

```jsonc
{
  "servers": {
    "github-personal": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_abc123..." }
    },
    "todoist": {
      "command": "npx",
      "args": ["-y", "@abhiz123/todoist-mcp-server"],
      "env": { "TODOIST_API_TOKEN": "tod_abc123..." }
    }
  }
}
```

Resolution:

```
"github-personal"
  → lookup:   config.servers["github-personal"]
  → resolved: npx ...server-github  env GITHUB_PERSONAL_ACCESS_TOKEN=ghp_abc123...

"todoist"
  → lookup:   config.servers["todoist"]
  → resolved: npx ...todoist-mcp-server  env TODOIST_API_TOKEN=tod_abc123...
```

Serialized for Claude → `options.mcpServers` (§5.1). Serialized for Codex → `options.config` flattened into `--config` flags (§5.2). The SDK spawns both servers as stdio child processes, and the agent connects to them for the duration of the run.

---

## 7. Adding a new MCP server

Users add a server by editing `~/.localcortex/mcp-servers.json` — no code change, no schema migration:

1. Add a new entry under `servers` with the desired name, `command`, `args`, and `env` (including token).
2. Reference that name from any rule's `mcpServers` array.
3. Run the rule.

That's it. The loader, resolver, and both backend serializers are name-driven and open-ended.

### Example: add a Jira source

```jsonc
"servers": {
  ...
  "jira-acme": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-jira"],
    "env": {
      "JIRA_API_TOKEN": "...",
      "JIRA_HOST": "acme.atlassian.net",
      "JIRA_EMAIL": "colin@acme.com"
    }
  }
}
```

Then a rule can use `"mcpServers": ["jira-acme", "todoist"]` and describe in its `rule` text what to look for in Jira and what to do.

---

## 8. Security notes

- **Tokens are stored as plaintext in `~/.localcortex/mcp-servers.json`.** This is the deliberate trade-off of the user-editable file approach (Option C1). The file is self-contained and simple to manage, but anyone with read access to the user's home directory — including malware running as the user, backup systems, or accidental sharing — can read the tokens.
  - **Mitigation:** set the file permissions to `0600` (owner read/write only) when the app creates it. Document this clearly. Users who need stronger protection can store the file on an encrypted volume or use a secrets manager that materializes the file at login.
- **Credentials reach servers only via process env at spawn time.** The lifecycle manager reads the file, sets the env vars on each spawned child process, and the child reads them as normal env. The tokens are not retained in app memory beyond the run.
- **Per-run respawn** ([architecture.md §5.4](./architecture.md#54-lifecycle--respawn-per-run)) means no long-lived process holds credentials. Each server process lives only for the duration of one agent run.
- **Codex passes tokens as CLI args.** MCP server credentials reach Codex via `--config mcp_servers.<name>.env.<KEY>=<value>` flags, visible in `ps`/process listings for the run's duration. This is local to the user's own processes and ephemeral — no token-bearing file is written to disk, so there is nothing to clean up at teardown. Claude avoids this surface entirely (servers passed as an in-memory `options.mcpServers` dict).
- **The config file must not be committed to version control** or shared verbatim. Users managing rules in git (a future feature) should treat `mcp-servers.json` like `.env` — gitignored, distributed out of band.

---

## 9. Open questions

- **Version pinning:** `npx -y` fetches latest on each spawn. For reproducibility and to mitigate supply-chain risk, v1.1+ should pin exact versions in `args` (e.g., `@modelcontextprotocol/server-github@1.2.3`). Users can do this manually today in their config file.
- **Hot reload:** if the user edits `mcp-servers.json`, does the running app pick it up, or is an app restart required? v1 likely loads at startup; hot-reload is a v1.1 convenience.
