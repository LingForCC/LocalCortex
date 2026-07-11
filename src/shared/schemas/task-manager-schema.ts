/**
 * Zod schema for a task-manager catalog entry (the `task_managers` table).
 *
 * A task-manager entry is the handoff catalog's *sink* layer: user-facing
 * metadata (label, token instructions) plus a reference to an MCP server row by
 * name. It carries no spawn config itself — the referenced `mcp_servers` row is
 * the source of truth for command/args/env.
 *
 * Spec: docs/features/handoff-setup/README.md.
 */

import { z } from 'zod';

export const TaskManagerSchema = z.object({
  /** Stable id, also the PK. */
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  description: z.string().trim().min(1),
  /** FK → mcp_servers.name. The server that actually writes tasks. */
  mcpServerName: z.string().trim().min(1),
  /** Whether the user must supply an API token for this manager. */
  requiresToken: z.boolean().default(false),
  /** The env var name the token goes into (e.g. 'TODOIST_API_TOKEN'). Null if none. */
  tokenEnvVar: z.string().trim().min(1).nullable(),
  /** Markdown/plain-text instructions shown in onboarding. */
  setupInstructions: z.string().trim().min(1),
  /** Seeded defaults are editable but not deletable. */
  isBuiltin: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Input shape for create/update (no timestamps; isBuiltin defaults to false). */
export const TaskManagerInputSchema = TaskManagerSchema.omit({
  createdAt: true,
  updatedAt: true,
});
