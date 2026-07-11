/**
 * Zod schemas for IPC messages crossing the main/renderer boundary
 * (docs/tech-stack.md §2 — Zod "validating IPC messages").
 *
 * Channels are namespaced `domain:action`. Each handler in src/main/ipc/
 * validates its incoming payload with the matching schema before acting.
 *
 * The renderer side is typed via the preload `contextBridge` exposure; these
 * schemas guard the main side.
 */

import { z } from 'zod';
import { RuleSchema } from './rule-schema.js';
import { HandoffSchema, CreateHandoffSchema } from './handoff-schema.js';
import { APPEARANCES } from '../constants.js';

// --- Channel name constants -------------------------------------------------

export const IPC = {
  RULE_LIST: 'rules:list',
  RULE_GET: 'rules:get',
  RULE_CREATE: 'rules:create',
  RULE_UPDATE: 'rules:update',
  RULE_DELETE: 'rules:delete',
  RULE_SET_ENABLED: 'rules:setEnabled',

  RUN_LIST: 'runs:list',
  RUN_GET: 'runs:get',
  RUN_TRIGGER: 'runs:trigger',

  HANDOFF_LIST: 'handoffs:list',
  HANDOFF_GET: 'handoffs:get',
  HANDOFF_CREATE: 'handoffs:create',
  HANDOFF_DELETE: 'handoffs:delete',
  HANDOFF_SET_ENABLED: 'handoffs:setEnabled',

  /**
   * Main → popup push: a prompt-submit event arrived and the handoff-attach
   * popup should show (or refresh) for this sessionId. Payload is
   * `HandoffPromptPayloadSchema`.
   */
  HANDOFF_PROMPT_PUSH: 'handoffs:prompt',
  /**
   * Main → main-window push: a handoff changed (created/toggled/deleted),
   * possibly from the popup window. The main Handoffs panel reloads its list.
   */
  HANDOFFS_CHANGED: 'handoffs:changed',

  SERVERS_LIST: 'servers:list',
  SERVERS_READ: 'servers:read',
  SERVERS_VALIDATE: 'servers:validate',

  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',

  // --- Catalog CRUD (agents, task managers, MCP servers) -------------------
  AGENTS_LIST: 'agents:list',
  AGENTS_GET: 'agents:get',
  AGENTS_CREATE: 'agents:create',
  AGENTS_UPDATE: 'agents:update',
  AGENTS_DELETE: 'agents:delete',

  TASK_MANAGERS_LIST: 'task-managers:list',
  TASK_MANAGERS_GET: 'task-managers:get',
  TASK_MANAGERS_CREATE: 'task-managers:create',
  TASK_MANAGERS_UPDATE: 'task-managers:update',
  TASK_MANAGERS_DELETE: 'task-managers:delete',

  MCP_SERVERS_LIST: 'mcp-servers:list',
  MCP_SERVERS_GET: 'mcp-servers:get',
  MCP_SERVERS_UPSERT: 'mcp-servers:upsert',
  MCP_SERVERS_DELETE: 'mcp-servers:delete',

  // --- Handoff setup --------------------------------------------------------
  HANDOFF_SETUP_COMPLETE: 'handoff-setup:complete',
  HANDOFF_SETUP_RESET: 'handoff-setup:reset',

  THEME_APPLY: 'theme:apply',
} as const;

// --- Rules ------------------------------------------------------------------

export const RuleIdSchema = z.object({ id: z.string().min(1) });

export const CreateRuleMessageSchema = RuleSchema;

export const UpdateRuleMessageSchema = RuleSchema;

export const SetRuleEnabledMessageSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
});

// --- Runs -------------------------------------------------------------------

export const ListRunsMessageSchema = z.object({
  // null/undefined both mean "no rule filter" — the renderer store + preload
  // pass null (see window.api.runs.list), so accept it here rather than forcing
  // a renderer-side normalization.
  ruleId: z.string().min(1).nullable().optional(),
  limit: z.number().int().positive().max(500).default(100),
});

export const TriggerRunMessageSchema = z.object({
  ruleId: z.string().min(1),
  /** Optional synthetic event payload for manually triggering an event rule. */
  eventPayload: z.record(z.string(), z.unknown()).optional(),
});

// --- Handoffs (pending reviews) --------------------------------------------

export const HandoffIdSchema = z.object({ id: z.string().min(1) });

/** `handoffs:create` payload. `CreateHandoffSchema` carries sessionId/context. */
export const CreateHandoffMessageSchema = CreateHandoffSchema;

/** `handoffs:setEnabled` payload. */
export const SetHandoffEnabledMessageSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
});

/**
 * Payload pushed over `handoffs:prompt` to the popup window. Drives whether the
 * popup renders the "attach" form (new session) or the "enable/disable" toggle
 * (existing session).
 *
 * - `mode: 'new'` → no handoff row exists for `sessionId`; `handoff` is null.
 * - `mode: 'existing'` → a handoff row exists; `handoff` is the current row so
 *   the popup can show its enabled state and reminder title.
 */
export const HandoffPromptPayloadSchema = z.object({
  /** The agent session id this prompt is about. */
  sessionId: z.string().min(1),
  /** Which UI to render. */
  mode: z.enum(['new', 'existing']),
  /** Event source: 'zcode' | 'codex' | <custom>. Informational only. */
  source: z.string(),
  /** The current handoff row for `existing` mode; null for `new` mode. */
  handoff: HandoffSchema.nullable(),
});

/** Inferred TS type for the handoff prompt push payload. */
export type HandoffPromptPayload = z.infer<typeof HandoffPromptPayloadSchema>;

// --- Settings ---------------------------------------------------------------

// settings:get takes no args; settings:update takes a partial settings object.
export const UpdateSettingsMessageSchema = z.object({
  tickIntervalSeconds: z.number().int().positive().min(300).optional(),
  concurrency: z.number().int().positive().optional(),
  /** Color scheme. `system` follows the OS preference. */
  appearance: z.enum(APPEARANCES).optional(),
  ingressSecret: z.string().nullable().optional(),
  /** Explicit path to a local `codex` CLI. null clears it (auto-detect/default). */
  codexCliPath: z.string().nullable().optional(),
  /** Explicit path to a local Claude Code CLI. null clears it (auto-detect/default). */
  claudeCliPath: z.string().nullable().optional(),
  // Handoff specialization — managed by handoff-setup:complete / reset, not the
  // Settings view directly. Accepted here so they round-trip through the shared
  // settings patch builder.
  handoffAgentId: z.string().nullable().optional(),
  handoffTaskManagerId: z.string().nullable().optional(),
  handoffBackend: z.enum(['claude', 'codex']).nullable().optional(),
  handoffRuleId: z.string().nullable().optional(),
});

/**
 * Result of `settings:update`. The handler validates CLI paths (exists +
 * executable) before persisting; on failure it returns `{ ok: false, error }`
 * instead of throwing, so the renderer can surface the message inline.
 */
export const UpdateSettingsResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  settings: z.any().optional(),
});

// --- Catalog: agents, task managers, MCP servers ---------------------------

export const IdSchema = z.object({ id: z.string().min(1) });
export const NameSchema = z.object({ name: z.string().min(1) });

// --- Handoff setup ---------------------------------------------------------

/** `handoff-setup:complete` — the three onboarding choices. */
export const HandoffSetupCompleteSchema = z.object({
  agentId: z.string().min(1),
  taskManagerId: z.string().min(1),
  backend: z.enum(['claude', 'codex']),
});

/** `handoff-setup:complete` result. */
export const HandoffSetupResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  settings: z.any().optional(),
  rule: z.any().optional(),
});

/** Inferred TS type for the handoff-setup:complete result. */
export type HandoffSetupResult = z.infer<typeof HandoffSetupResultSchema>;
