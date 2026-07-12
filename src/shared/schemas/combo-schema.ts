/**
 * Zod schema for a `handoff_combos` table row — a "combo".
 *
 * A combo binds together the three onboarding choices that previously formed
 * the singleton handoff setup: a coding **agent** (event source), a
 * **task manager** (sink), and a **backend** (runner). Each combo owns exactly
 * one auto-created rule (`rule_id`) whose trigger listens to the agent's
 * `session-complete` event type, so multiple combos can run in parallel — one
 * per agent source — and the matcher fires every matching rule.
 *
 * Spec: docs/features/handoff-setup/README.md.
 */

import { z } from 'zod';

/**
 * The full combo row (mirrors the `handoff_combos` table).
 *
 * `ruleId` points at the rule this combo owns; the IPC layer keeps the rule's
 * combo-owned fields (trigger eventType, mcpServers, backend, name) in sync
 * with the combo, while preserving any user edits to the prompt/model/etc.
 */
export const ComboSchema = z.object({
  /** Stable unique id (TEXT primary key). */
  id: z.string().min(1),
  /** Human-readable label shown in the Combos tab. */
  label: z.string().trim().min(1),
  /** The coding-agent catalog id (event source). FK -> agents(id). */
  agentId: z.string().trim().min(1),
  /** The task-manager catalog id (sink layer). FK -> task_managers(id). */
  taskManagerId: z.string().trim().min(1),
  /** Which backend fulfills the combo's rule. Independent of the agent source. */
  backend: z.enum(['claude', 'codex']),
  /** The id of the auto-created rule owned by this combo. FK -> rules(id). */
  ruleId: z.string().trim().min(1),
  /**
   * Whether this combo is active. Mirrored onto rule.enabled by the IPC layer;
   * the scheduler only fires rules whose enabled flag is true, so disabling a
   * combo stops it from firing.
   */
  enabled: z.boolean(),
  /** ISO timestamp the combo was created. */
  createdAt: z.string(),
  /** ISO timestamp of the last update. */
  updatedAt: z.string(),
});

/**
 * Shape accepted when creating a combo. `id`/`ruleId`/`enabled`/timestamps are
 * minted by the IPC layer (it also creates the owned rule), so the caller only
 * supplies the four configuration choices.
 */
export const CreateComboSchema = z.object({
  label: z.string().trim().min(1),
  agentId: z.string().trim().min(1),
  taskManagerId: z.string().trim().min(1),
  backend: z.enum(['claude', 'codex']),
});

/**
 * Shape accepted when updating a combo. All fields optional; any present field
 * is applied to both the combo and (for the combo-owned fields) its rule.
 */
export const UpdateComboSchema = CreateComboSchema.partial();

/** Input accepted by the `combos:create` IPC channel. */
export type CreateCombo = z.infer<typeof CreateComboSchema>;

/** Input accepted by the `combos:update` IPC channel. */
export type UpdateCombo = z.infer<typeof UpdateComboSchema>;
