/**
 * Zod schema for a coding-agent catalog entry (the `agents` table).
 *
 * An agent entry describes an event *source*: which event types LocalCortex
 * listens for, and what to show the user during onboarding. It carries no
 * execution concerns (backend, MCP) — those are independent onboarding choices.
 * The user is responsible for making their agent actually emit the events
 * (installing the hook/plugin on the agent side).
 *
 * Spec: docs/features/handoff-setup/README.md.
 */

import { z } from 'zod';

export const AgentSchema = z.object({
  /** Stable id, also the PK. */
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  description: z.string().trim().min(1),
  /** Event type to match on session completion, e.g. 'zcode.session-complete'. */
  sessionCompleteEventType: z.string().trim().min(1),
  /** Event type for the prompt-submit popup, e.g. 'zcode.prompt-submit'. */
  promptSubmitEventType: z.string().trim().min(1),
  /** Event source string, e.g. 'zcode'. */
  source: z.string().trim().min(1),
  /** Markdown/plain-text instructions shown in onboarding. */
  installInstructions: z.string().trim().min(1),
  /** Seeded defaults are editable but not deletable. */
  isBuiltin: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Input shape for create/update (no timestamps; isBuiltin defaults to false). */
export const AgentInputSchema = AgentSchema.omit({ createdAt: true, updatedAt: true });
