-- Catalog tables for the handoff-focused specialization.
--
-- Replaces the static ~/.localcortex/mcp-servers.json file with DB-backed
-- catalogs for MCP servers (the generic engine layer), agents (the event-source
-- layer), and task managers (the sink layer). All three are seeded on first run
-- and CRUD-able in-app, so adding a new agent/task-manager/server is a data
-- operation, not a code change.
--
-- Credentials are plaintext here, same posture as the old 0600 file
-- (docs/mcp-servers.md §8). The DB lives in Electron's userData dir.

-- ---------------------------------------------------------------------------
-- mcp_servers: the single source of truth for MCP server spawn configs.
--              Replaces ~/.localcortex/mcp-servers.json. The run-loop reads
--              these via McpServersRepository.getAsConfig(), producing the same
--              McpServersFile-shaped object the resolver/serializers expect.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_servers (
  name        TEXT PRIMARY KEY,                         -- what rule.mcpServers references
  transport   TEXT NOT NULL DEFAULT 'stdio',            -- v1: stdio only
  command     TEXT NOT NULL,
  args_json   TEXT NOT NULL DEFAULT '[]',               -- JSON string[]
  env_json    TEXT NOT NULL DEFAULT '{}',               -- JSON Record<string,string> (holds plaintext tokens)
  is_builtin  INTEGER NOT NULL DEFAULT 0,               -- 1 = seeded default (editable, not deletable)
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed the v1 defaults (mcp-servers.md §3). Tokens are placeholders the user
-- replaces in-app (Sources tab) or via a custom task-manager's setup.
INSERT INTO mcp_servers (name, transport, command, args_json, env_json, is_builtin) VALUES
  ('github',
   'stdio',
   'npx',
   '["-y","@modelcontextprotocol/server-github"]',
   '{"GITHUB_PERSONAL_ACCESS_TOKEN":"<your-token-here>"}',
   1),
  ('gitlab',
   'stdio',
   'npx',
   '["-y","@modelcontextprotocol/server-gitlab"]',
   '{"GITLAB_PERSONAL_ACCESS_TOKEN":"<your-token-here>","GITLAB_API_URL":"https://gitlab.com/api/v4"}',
   1),
  ('todoist',
   'stdio',
   'npx',
   '["-y","@abhiz123/todoist-mcp-server"]',
   '{"TODOIST_API_TOKEN":"<your-token-here>"}',
   1),
  ('omnifocus',
   'stdio',
   'node',
   '["<path-to-omnifocus-mcp>/dist/index.js"]',
   '{}',
   1);

-- ---------------------------------------------------------------------------
-- agents: the handoff catalog's event-source layer. Each row tells the app
--         which event types to listen for and what to show the user during
--         onboarding. The user is responsible for making their agent emit the
--         events (installing the hook/plugin on the agent side).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agents (
  id                          TEXT PRIMARY KEY,
  label                       TEXT NOT NULL,
  description                 TEXT NOT NULL,
  session_complete_event_type TEXT NOT NULL,            -- e.g. 'zcode.session-complete'
  prompt_submit_event_type    TEXT NOT NULL,            -- e.g. 'zcode.prompt-submit'
  source                      TEXT NOT NULL,            -- event source string
  install_instructions        TEXT NOT NULL,            -- shown in onboarding review step
  is_builtin                  INTEGER NOT NULL DEFAULT 1,
  created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO agents (id, label, description, session_complete_event_type, prompt_submit_event_type, source, install_instructions, is_builtin) VALUES
  ('zcode',
   'ZCode',
   'ZCode coding agent (Claude-based). Emits session events via the LocalCortex ZCode hook plugin.',
   'zcode.session-complete',
   'zcode.prompt-submit',
   'zcode',
   'Install the localcortex-hook ZCode plugin (see packaging/zcode-hook-plugin/). It registers Stop and UserPromptSubmit hooks that POST events to LocalCortex automatically. No env vars needed if LocalCortex runs on the default port.',
   1),
  ('codex',
   'Codex',
   'OpenAI Codex CLI agent. Emits session events via the bundled Codex hook scripts.',
   'codex.session-complete',
   'codex.prompt-submit',
   'codex',
   'Wire the Codex hook scripts (src/main/events/codex-hook.sh and codex-prompt-submit-hook.sh) into your Codex hooks config. They POST session-complete and prompt-submit events to LocalCortex.',
   1);

-- ---------------------------------------------------------------------------
-- task_managers: the handoff catalog's sink layer. Each row references an
--                mcp_servers row by name and carries the user-facing metadata
--                (label, token instructions) shown during onboarding.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_managers (
  id                 TEXT PRIMARY KEY,
  label              TEXT NOT NULL,
  description        TEXT NOT NULL,
  mcp_server_name    TEXT NOT NULL,                     -- FK -> mcp_servers.name
  requires_token     INTEGER NOT NULL DEFAULT 0,        -- 1 = user must supply a token
  token_env_var      TEXT,                              -- e.g. 'TODOIST_API_TOKEN' (nullable)
  setup_instructions TEXT NOT NULL,                     -- shown in onboarding review step
  is_builtin         INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (mcp_server_name) REFERENCES mcp_servers(name) ON DELETE RESTRICT
);

INSERT INTO task_managers (id, label, description, mcp_server_name, requires_token, token_env_var, setup_instructions, is_builtin) VALUES
  ('omnifocus',
   'OmniFocus',
   'OmniFocus task manager (macOS). Uses a community JXA-based MCP server that talks to OmniFocus via osascript. No API token required — relies on the local OmniFocus app.',
   'omnifocus',
   0,
   NULL,
   'Clone and build leedoughty/omnifocus-mcp, then edit the omnifocus MCP server (Sources tab) to point args at your built dist/index.js path. On first use, macOS prompts to grant Automation permission for OmniFocus.',
   1);
