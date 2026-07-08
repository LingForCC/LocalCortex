/**
 * Zod schema for a `pending_reviews` table row — a "handoff".
 *
 * A handoff correlates an in-flight agent session id with a set of free-form
 * context key-values. When the session completes (an event carrying that
 * sessionId hits the ingress), LocalCortex merges the context into the event
 * payload so an event-triggered rule can render `{{key}}` template variables
 * (e.g. `{{parentTaskId}}`) into its prompt and act (e.g. create a review
 * subtask).
 *
 * The `context` map is deliberately opaque: LocalCortex has NO domain knowledge
 * of any task manager (OmniFocus, Todoist, Linear, …). It is a dumb pipe that
 * stores user-supplied key-values and forwards them to the agent run. Adding a
 * new task manager needs no schema or code change — only rule text.
 *
 * Agent-source multi-support (ZCode / Codex / Cursor / Claude) is likewise
 * free: each source is just a different completion event type + hook script;
 * `sessionId` is an opaque string the hook normalizes from whatever env var
 * the source exposes.
 */

import { z } from 'zod';

/** Lifecycle of a handoff. */
export const HandoffStatusSchema = z.enum(['pending', 'fulfilled', 'cancelled']);

/**
 * The full handoff row (mirrors the `pending_reviews` table).
 *
 * `context` is the Level-2 abstraction: a free-form map merged into the
 * triggering event's payload at completion time.
 */
export const HandoffSchema = z.object({
  /** Stable unique id (TEXT primary key). */
  id: z.string().min(1),
  /**
   * The agent session id this handoff watches (opaque). When an event whose
   * `payload.sessionId` equals this value arrives, the handoff fires.
   */
  sessionId: z.string().min(1),
  /**
   * Free-form context merged into the event payload on completion. Keys become
   * `{{key}}` template variables available to the fulfilling rule. Examples:
   * `{ parentTaskId: 'o2LOz5FWVIj', taskManager: 'omnifocus' }`.
   */
  context: z.record(z.string(), z.string()).default({}),
  /** Optional human-readable label for the reminder (purely informational). */
  reminderTitle: z.string().optional(),
  /** Lifecycle state. Only `pending` handoffs fire. */
  status: HandoffStatusSchema,
  /** The id of the rule that fulfilled this handoff, once it has (informational). */
  ruleId: z.string().optional(),
  /** The runs.id that fulfilled this handoff, once it has (informational). */
  fulfilledRunId: z.number().int().positive().optional(),
  /** ISO timestamp the handoff was registered. */
  createdAt: z.string(),
  /** ISO timestamp of the last update. */
  updatedAt: z.string(),
});

/** Shape accepted when creating a handoff (id/status/timestamps inferred). */
export const CreateHandoffSchema = z.object({
  sessionId: z.string().trim().min(1),
  context: z.record(z.string(), z.string()).default({}),
  reminderTitle: z.string().trim().optional(),
});

/** Input accepted by the `handoffs:create` IPC channel. */
export type CreateHandoff = z.infer<typeof CreateHandoffSchema>;
