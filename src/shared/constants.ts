/**
 * App-wide constants. Sourced from docs/architecture.md, docs/tech-stack.md,
 * docs/mcp-servers.md, and docs/rule-config-schema.md.
 */

/** Minimum allowed tick interval for a tick-triggered rule (rule-config-schema §11.2). */
export const MIN_TICK_INTERVAL_SECONDS = 300;

/** Default tick interval when a rule omits `trigger.intervalSeconds` (arch §6.5: 60 min). */
export const DEFAULT_TICK_INTERVAL_SECONDS = 3600;

/** Default concurrency cap for the agent-run queue (arch §6.4). */
export const DEFAULT_CONCURRENCY = 3;

/** Valid appearance modes. `system` follows the OS `prefers-color-scheme`. */
export const APPEARANCES = ['system', 'light', 'dark'] as const;
/** Default appearance — follow the OS preference out of the box. */
export const DEFAULT_APPEARANCE = 'system';

/** Default `maxRuns` backstop when a rule omits it (rule-config-schema §7: ≈2 days @ 60min). */
export const DEFAULT_MAX_RUNS = 48;

/** Port for the local HTTP event ingress (arch §6.7 example uses 4729). */
export const INGRESS_PORT = 4729;

/** Host the event ingress binds to — loopback only (arch §6.7). */
export const INGRESS_HOST = '127.0.0.1';

/**
 * Placeholder token the bundled default mcp-servers.json ships with.
 * The lifecycle manager rejects a server whose env still contains this
 * value (mcp-servers.md §5.3, rule-config-schema §11.4).
 */
export const PLACEHOLDER_TOKEN = '<your-token-here>';

/** Event type emitted by the shipped Codex `session-complete` hook (arch §6.7). */
export const CODEX_SESSION_COMPLETE_EVENT = 'codex.session-complete';

/** Event type for Claude Code session completion (arch §3.4). */
export const CLAUDE_SESSION_COMPLETE_EVENT = 'claude.session-complete';

/** Status values the agent emits in the status-contract block (arch §6.6). */
export const RULE_STATUSES = ['active', 'done', 'error'] as const;

/** Name of the app's SQLite file, relative to Electron's userData dir. */
export const DB_FILENAME = 'localcortex.db';

/** Name of the user-editable MCP servers file (relative to ~/.localcortex/). */
export const MCP_SERVERS_FILENAME = 'mcp-servers.json';

/** Directory under the home folder holding all app runtime data. */
export const APP_DATA_DIRNAME = '.localcortex';

/** Subdir under APP_DATA_DIR holding per-run staging workdirs (Codex). */
export const RUNS_SUBDIR = 'runs';

/** SQLite PRAGMAs applied on connection (tech-stack.md §4). */
export const DB_PRAGMAS = ['PRAGMA journal_mode = WAL;', 'PRAGMA foreign_keys = ON;'] as const;
