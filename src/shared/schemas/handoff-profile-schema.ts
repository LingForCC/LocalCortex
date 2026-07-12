/**
 * Zod schema for a `handoff_profiles` table row — a "handoff profile".
 *
 * A profile binds together the three onboarding choices that previously formed
 * the singleton handoff setup: a coding **agent** (event source), a **task
 * manager** (sink), and a **backend** (runner). Each profile owns exactly one
 * auto-created rule (`rule_id`) whose trigger listens to the agent's
 * `session-complete` event type, so multiple profiles can run in parallel — one
 * per agent source — and the matcher fires every matching rule.
 *
 * (Formerly called "combo".)
 *
 * Spec: docs/features/handoff-profiles/README.md.
 */

import { z } from 'zod';

/**
 * The full profile row (mirrors the `handoff_profiles` table).
 *
 * `ruleId` points at the rule this profile owns; the IPC layer keeps the rule's
 * profile-owned fields (trigger eventType, mcpServers, backend, name) in sync
 * with the profile, while preserving any user edits to the prompt/model/etc.
 */
export const HandoffProfileSchema = z.object({
  /** Stable unique id (TEXT primary key). */
  id: z.string().min(1),
  /** Human-readable label shown in the Handoff profiles tab. */
  label: z.string().trim().min(1),
  /** The coding-agent catalog id (event source). FK -> agents(id). */
  agentId: z.string().trim().min(1),
  /** The task-manager catalog id (sink layer). FK -> task_managers(id). */
  taskManagerId: z.string().trim().min(1),
  /** Which backend fulfills the profile's rule. Independent of the agent source. */
  backend: z.enum(['claude', 'codex']),
  /** The id of the auto-created rule owned by this profile. FK -> rules(id). */
  ruleId: z.string().trim().min(1),
  /**
   * Whether this profile is active. Mirrored onto rule.enabled by the IPC layer;
   * the scheduler only fires rules whose enabled flag is true, so disabling a
   * profile stops it from firing.
   */
  enabled: z.boolean(),
  /** ISO timestamp the profile was created. */
  createdAt: z.string(),
  /** ISO timestamp of the last update. */
  updatedAt: z.string(),
});

/**
 * Shape accepted when creating a profile. `id`/`ruleId`/`enabled`/timestamps
 * are minted by the IPC layer (it also creates the owned rule), so the caller
 * only supplies the four configuration choices.
 */
export const CreateHandoffProfileSchema = z.object({
  label: z.string().trim().min(1),
  agentId: z.string().trim().min(1),
  taskManagerId: z.string().trim().min(1),
  backend: z.enum(['claude', 'codex']),
});

/**
 * Shape accepted when updating a profile. All fields optional; any present
 * field is applied to both the profile and (for the profile-owned fields) its
 * rule.
 */
export const UpdateHandoffProfileSchema = CreateHandoffProfileSchema.partial();

/** Input accepted by the `handoff-profiles:create` IPC channel. */
export type CreateHandoffProfile = z.infer<typeof CreateHandoffProfileSchema>;

/** Input accepted by the `handoff-profiles:update` IPC channel. */
export type UpdateHandoffProfile = z.infer<typeof UpdateHandoffProfileSchema>;
