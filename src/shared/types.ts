/**
 * Shared TypeScript types — the single source of truth for the app's data model.
 *
 * Every type here is derived from a Zod schema in `./schemas/` so that config,
 * DB rows, event payloads, and IPC messages share one validation surface
 * (docs/tech-stack.md §2, §4).
 *
 * Mirrors docs/features/rules/README.md ("TypeScript types").
 */

import type { z } from 'zod';
import type {
  RuleSchema,
  TriggerSchema,
  TickTriggerSchema,
  EventTriggerSchema,
} from './schemas/rule-schema.js';
import type { IncomingEventSchema } from './schemas/event-schema.js';
import type {
  McpServersFileSchema,
  McpServerConfigSchema,
  ResolvedMcpServerSchema,
} from './schemas/mcp-config-schema.js';
import type { RunSchema } from './schemas/run-schema.js';
import type { HandoffSchema } from './schemas/handoff-schema.js';
import type {
  ComboSchema,
  CreateComboSchema,
  UpdateComboSchema,
} from './schemas/combo-schema.js';
import type { AppSettingsSchema } from './schemas/settings-schema.js';
import type { AgentSchema } from './schemas/agent-schema.js';
import type { TaskManagerSchema } from './schemas/task-manager-schema.js';
import type { McpServerEntrySchema } from './schemas/mcp-server-schema.js';

// --- Rule model (rules README → "TypeScript types") ------------------------

export type AgentBackend = 'claude' | 'codex';
export type SandboxMode = 'read-only' | 'workspace-write';
export type TriggerType = 'tick' | 'event';

/**
 * A server name as defined in ~/.localcortex/mcp-servers.json.
 * Open-ended (any string the user defined) — see mcp-servers.md §2.
 */
export type McpServerName = string;

export type Rule = z.infer<typeof RuleSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type TickTrigger = z.infer<typeof TickTriggerSchema>;
export type EventTrigger = z.infer<typeof EventTriggerSchema>;

/**
 * A Rule plus the bookkeeping columns the rules table tracks (run count,
 * disable reason, timestamps). Returned by the rules IPC list/get handlers so
 * the renderer can show run counts and auto-disable reasons.
 */
export interface RuleWithBookkeeping extends Rule {
  runCount: number;
  disableReason?: string;
  createdAt: string;
  updatedAt: string;
}

// --- Agent status contract (architecture.md §6.6) --------------------------

/** Parsed status block emitted by the agent at the end of each run. */
export type RuleStatus = 'active' | 'done' | 'error';

export interface ParsedStatus {
  status: RuleStatus;
  reason?: string;
}

// --- Events (architecture.md §6.7) -----------------------------------------

/**
 * Arbitrary external event POSTed to the local ingress. Beyond the required
 * `type` and `timestamp`, fields are open-ended — whatever the source sends.
 * Template variables in rule text (`{{workdir}}`, …) render from `payload`.
 */
export type IncomingEvent = z.infer<typeof IncomingEventSchema>;

// --- MCP config (mcp-servers.md §2) ----------------------------------------

/** A single server definition as authored in mcp-servers.json. */
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

/** The whole user-editable mcp-servers.json file. */
export type McpServersFile = z.infer<typeof McpServersFileSchema>;

/** A resolved server (name → concrete spawn config), after resolution (mcp-servers.md §4). */
export type ResolvedMcpServer = z.infer<typeof ResolvedMcpServerSchema>;

/** Map of server name → resolved spawn config. */
export type ResolvedMcpServers = Record<string, ResolvedMcpServer>;

// --- Run history / observability (architecture.md §4, §7) -------------------

export type Run = z.infer<typeof RunSchema>;

/** Outcome of an agent run, recorded to the `runs` table. */
export type RunStatus = 'success' | 'error';

// --- Handoffs / pending reviews --------------------------------------------

/** A registered agent-session handoff (pending_reviews row). */
export type Handoff = z.infer<typeof HandoffSchema>;

// --- Combos (agent + task-manager + backend) --------------------------------

/** A configured combo owning one auto-created rule (handoff_combos row). */
export type Combo = z.infer<typeof ComboSchema>;
export type CreateCombo = z.infer<typeof CreateComboSchema>;
export type UpdateCombo = z.infer<typeof UpdateComboSchema>;

// --- Global settings (architecture.md §6.4, §6.5) --------------------------

export type AppSettings = z.infer<typeof AppSettingsSchema>;

// --- Catalog: agents, task managers, MCP servers ----------------------------
// DB-backed catalogs for the handoff specialization (migration 004). All three
// are seeded on first run and CRUD-able in-app.

/** A coding-agent catalog row (event source). */
export type AgentEntry = z.infer<typeof AgentSchema>;

/** A task-manager catalog row (sink layer). */
export type TaskManagerEntry = z.infer<typeof TaskManagerSchema>;

/** An MCP server catalog row (replaces the old mcp-servers.json file). */
export type McpServerEntry = z.infer<typeof McpServerEntrySchema>;
