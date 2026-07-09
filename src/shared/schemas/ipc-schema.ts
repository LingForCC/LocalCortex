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
import { CreateHandoffSchema } from './handoff-schema.js';
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

  SERVERS_LIST: 'servers:list',
  SERVERS_READ: 'servers:read',
  SERVERS_VALIDATE: 'servers:validate',

  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',

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
