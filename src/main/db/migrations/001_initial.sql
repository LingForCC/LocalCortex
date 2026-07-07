-- LocalCortex initial schema.
-- Spec: docs/tech-stack.md §4, docs/architecture.md §4.
--
-- Two core tables (rules, runs) plus an app_settings key/value table and a
-- schema_version tracking table for the migrations runner.
--
-- Credentials are deliberately NOT stored here — they live in
-- ~/.localcortex/mcp-servers.json (architecture.md §4).

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rules (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  enabled          INTEGER NOT NULL DEFAULT 1,        -- boolean 0/1
  rule             TEXT NOT NULL,                     -- natural-language instruction
  trigger_json     TEXT NOT NULL,                     -- JSON: TickTrigger | EventTrigger
  mcp_servers_json TEXT NOT NULL,                     -- JSON: string[]
  backend          TEXT NOT NULL,                     -- 'claude' | 'codex'
  workdir          TEXT,
  sandbox          TEXT NOT NULL DEFAULT 'read-only', -- 'read-only' | 'workspace-write'
  max_runs         INTEGER,                           -- NULL = unlimited / use global default
  expires_at       TEXT,                              -- ISO timestamp or NULL
  notes            TEXT,
  -- Bookkeeping
  run_count        INTEGER NOT NULL DEFAULT 0,        -- incremented per run (for maxRuns backstop)
  disable_reason   TEXT,                              -- why the rule was auto-disabled
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id        TEXT NOT NULL,
  trigger        TEXT NOT NULL,                       -- 'tick' | 'event' | 'manual'
  started_at     TEXT NOT NULL,                       -- ISO timestamp
  ended_at       TEXT,                                -- ISO timestamp, set when recorded
  status         TEXT NOT NULL,                       -- 'success' | 'error'
  prompt         TEXT NOT NULL,                       -- assembled prompt sent to the agent
  tool_calls     TEXT NOT NULL DEFAULT '[]',          -- JSON array of ToolCall
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  duration_ms    INTEGER,
  result         TEXT,                                -- agent's final text
  parsed_status  TEXT,                                -- JSON {status,reason} or NULL
  error          TEXT,
  event_payload  TEXT,                                -- JSON, event-triggered only
  FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_runs_rule_id ON runs(rule_id);
CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at);

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                                 -- JSON-encoded value
);
