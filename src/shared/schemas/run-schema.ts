/**
 * Zod schema for a `runs` table row — one recorded agent run.
 *
 * The runs table is the observability surface under auto-execute
 * (architecture.md §6.3, §7 step 6): every run records the prompt, tool calls,
 * token cost, duration, result, and the parsed status block.
 */

import { z } from 'zod';

export const RunStatusSchema = z.enum(['success', 'error']);

/** A single tool call observed during an agent run (best-effort capture). */
export const ToolCallSchema = z.object({
  tool: z.string(),
  args: z.unknown().optional(),
  result: z.unknown().optional(),
});

export const RunSchema = z.object({
  /** Auto-increment primary key. */
  id: z.number().int().positive(),
  ruleId: z.string().min(1),
  /** How the run was triggered. */
  trigger: z.enum(['tick', 'event', 'manual']),
  /** ISO timestamp the run started. */
  startedAt: z.string(),
  /** ISO timestamp the run ended (set when recorded). */
  endedAt: z.string().optional(),
  status: RunStatusSchema,
  /** The fully-assembled prompt sent to the agent (after template render). */
  prompt: z.string(),
  /** Tool calls observed during the run. */
  toolCalls: z.array(ToolCallSchema).default([]),
  /** Token usage, if the SDK reports it. */
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  /** Wall-clock duration in ms. */
  durationMs: z.number().int().nonnegative().optional(),
  /** The agent's final text result. */
  result: z.string().optional(),
  /** Parsed status block from the agent's output (arch §6.6). */
  parsedStatus: z
    .object({
      status: z.enum(['active', 'done', 'error']),
      reason: z.string().optional(),
    })
    .optional(),
  /** If the run errored, a short error message. */
  error: z.string().optional(),
  /** Event payload that triggered this run (event-triggered only), JSON-stringified. */
  eventPayload: z.string().optional(),
});
