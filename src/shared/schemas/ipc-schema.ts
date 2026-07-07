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

  SERVERS_LIST: 'servers:list',
  SERVERS_READ: 'servers:read',
  SERVERS_VALIDATE: 'servers:validate',

  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
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
  ruleId: z.string().min(1).optional(),
  limit: z.number().int().positive().max(500).default(100),
});

export const TriggerRunMessageSchema = z.object({
  ruleId: z.string().min(1),
  /** Optional synthetic event payload for manually triggering an event rule. */
  eventPayload: z.record(z.string(), z.unknown()).optional(),
});

// --- Settings ---------------------------------------------------------------

// settings:get takes no args; settings:update takes a partial settings object.
export const UpdateSettingsMessageSchema = z.object({
  tickIntervalSeconds: z.number().int().positive().min(300).optional(),
  concurrency: z.number().int().positive().optional(),
  ingressSecret: z.string().nullable().optional(),
});
