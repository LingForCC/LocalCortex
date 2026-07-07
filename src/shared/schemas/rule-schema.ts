/**
 * Zod schema for a Rule — the contract between the renderer (rule editor) and
 * the main process (scheduler, event ingress, AgentRunner).
 *
 * Spec: docs/rule-config-schema.md (full schema + §11 validation rules).
 * Stored as JSON in the `rules` table; `trigger`/`mcpServers` serialized as
 * JSON columns (docs/tech-stack.md §4).
 */

import { z } from 'zod';
import { MIN_TICK_INTERVAL_SECONDS } from '../constants.js';

// --- Trigger (rule-config-schema.md §3) ------------------------------------

export const TickTriggerSchema = z.object({
  type: z.literal('tick'),
  /** Falls back to the global default when omitted (arch §6.5). 5-min floor (§11.2). */
  intervalSeconds: z.number().int().positive().min(MIN_TICK_INTERVAL_SECONDS).optional(),
});

export const EventTriggerSchema = z.object({
  type: z.literal('event'),
  /** Required, non-empty — the event type to match, e.g. "codex.session-complete". */
  eventType: z.string().trim().min(1),
  /** Optional glob filters on event payload fields (v1: glob on string fields). */
  filter: z.record(z.string(), z.string()).optional(),
});

export const TriggerSchema = z.discriminatedUnion('type', [TickTriggerSchema, EventTriggerSchema]);

// --- Rule (rule-config-schema.md §1, §10) ----------------------------------

export const RuleSchema = z.object({
  /** Stable, unique id (used in run workdir paths and FKs). */
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  enabled: z.boolean().default(true),

  /** Natural-language instruction (§2). Non-empty (§11.5). */
  rule: z.string().trim().min(1),

  trigger: TriggerSchema,

  /**
   * Required, non-empty (§11.4). Every name must exist as a key in
   * mcp-servers.json at run time — that cross-file check lives in the resolver,
   * not here (the schema can't see the config file).
   */
  mcpServers: z.array(z.string().trim().min(1)).min(1),

  backend: z.enum(['claude', 'codex']),

  /** Defaults to a per-rule scratch dir when omitted (§6). */
  workdir: z.string().trim().optional(),
  sandbox: z.enum(['read-only', 'workspace-write']).default('read-only'),

  /** Positive int, or null for unlimited. Global default applied at run time (§7). */
  maxRuns: z.number().int().positive().nullable().optional(),
  /** ISO timestamp, no default. Future-ness validated in the repo layer (needs now()). */
  expiresAt: z.string().datetime().optional(),

  notes: z.string().optional(),
});

// Re-exported type aliases live in ../types.ts via z.infer.
export type RuleInput = z.input<typeof RuleSchema>;
