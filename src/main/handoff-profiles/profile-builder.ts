/**
 * Pure logic that builds the auto-created rule owned by a handoff profile.
 *
 * Spec: docs/features/handoff-profiles/README.md.
 *
 * This module is Electron-free and side-effect-free, so it's unit-testable in
 * plain Vitest (the "factor logic out of Electron" rule, docs/tech-stack.md §5).
 * It takes catalog entries (from the DB) + a backend choice and returns a `Rule`
 * object; the IPC layer owns the persistence side effects.
 *
 * The three choices are orthogonal:
 *   - agent        → the event *source* (which eventType the rule listens to)
 *   - taskManager  → the sink (which MCP server the rule uses)
 *   - backend      → which runner fulfills the rule (Claude/Codex SDK)
 *
 * One profile owns exactly one rule. Multiple profiles can run in parallel —
 * one per agent source — because each rule listens to its agent's distinct
 * session-complete event type and the matcher fires every matching rule.
 */

import type { Rule, AgentBackend } from '@shared/types';
import type { AgentEntry, TaskManagerEntry } from '@shared/types';

/**
 * Stable id for the legacy singleton handoff rule. Kept only so the migration
 * (006_handoff_profiles.sql) can copy a pre-existing setup into one profile row
 * reusing the same rule. New profiles mint per-profile rule ids (UUIDs) via the
 * IPC layer.
 */
export const HANDOFF_RULE_ID = 'handoff-auto';

/** Recognizable default name for a profile's auto-created rule. */
export const HANDOFF_RULE_NAME = 'Handoff (auto-created)';

/**
 * The generic "how to create a task" instruction used when a task manager has
 * no explicit `createTaskInstructions`. Used as step 2 of the default prompt so
 * the agent still has a clear instruction even without tool-specific guidance.
 */
export const FALLBACK_CREATE_TASK_INSTRUCTIONS =
  'Using the available MCP task-manager server, create a new subtask (or follow-up task) under {{parentTaskId}}. Use {{parentTaskName}} for context if available.';

/**
 * Build the default natural-language prompt for the handoff rule, tailored to
 * the task manager. When the task manager carries `createTaskInstructions`
 * (tool name + params, e.g. "Call mcp:omnifocus/add_omnifocus_task …"), that
 * text becomes step 2 verbatim so the agent knows the exact tool to call
 * instead of guessing from the attached server list. Otherwise step 2 falls
 * back to the generic instruction above.
 *
 * Either way the prompt renders `{{parentTaskId}}` / `{{parentTaskName}}` from
 * the handoff context merged into the event payload at enrichment time, and
 * no-ops when no parentTaskId is present (a handoff wasn't attached for this
 * session).
 */
export function buildDefaultHandoffRuleText(taskManager: TaskManagerEntry): string {
  const createTask = taskManager.createTaskInstructions?.trim() || FALLBACK_CREATE_TASK_INSTRUCTIONS;
  return `You are a task-management assistant. When a coding agent session completes, create a review subtask so the user remembers to review the agent's work.

Steps:
1. Read the parent task id from {{parentTaskId}}. If it is empty, output the status block with status=active and reason="no parent task" — do nothing else.
2. ${createTask}
3. The subtask should remind the user to review the completed work. Title it something like "Review: {{parentTaskName}}".

Always end with a status block:
<status>
status: active | done | error
reason: <one line>
</status>`;
}

/**
 * Build a new handoff Rule owned by a profile. The caller supplies the rule id
 * (a fresh UUID per profile), so each profile owns its own row independent of
 * any other profile.
 *
 * The rule:
 *   - listens to the agent's session-complete event type
 *   - runs on the independently-chosen backend
 *   - uses the task manager's MCP server
 *   - is read-only (MCP tool calls aren't filesystem writes)
 *   - has the default review-subtask prompt, tailored to the task manager's
 *     `createTaskInstructions` (tool name + params) when present
 */
export function buildHandoffProfileRule(
  agent: AgentEntry,
  taskManager: TaskManagerEntry,
  backend: AgentBackend,
  options: { id: string; name?: string },
): Rule {
  return {
    id: options.id,
    name: options.name ?? HANDOFF_RULE_NAME,
    enabled: true,
    rule: buildDefaultHandoffRuleText(taskManager),
    trigger: {
      type: 'event',
      eventType: agent.sessionCompleteEventType,
    },
    mcpServers: [taskManager.mcpServerName],
    backend,
    sandbox: 'read-only',
    notes:
      `Auto-created by handoff profile. Agent: ${agent.label}. ` +
      `Task manager: ${taskManager.label}. ` +
      `Edit freely — the profile keeps this rule's trigger/server/backend in sync and preserves your prompt/model edits.`,
  };
}

/**
 * Apply the profile-owned fields onto an existing rule, preserving everything
 * the user may have edited. Used when a profile is updated (agent / task
 * manager / backend / label changed): only the fields the profile owns are
 * overwritten.
 *
 * Preserved user-editable fields:
 *   - `rule`        (prompt text — so the task-manager-tailored prompt set at
 *                    creation is NOT overwritten if the task manager changes
 *                    later; only initial creation templates it)
 *   - `model` / `modelReasoningEffort` (per-rule Codex overrides)
 *   - `workdir`, `sandbox`, `maxRuns`, `expiresAt`, `notes`
 *
 * Also preserves bookkeeping that lives on the rule row but is managed by other
 * flows: `enabled` (mirrored from the profile via setEnabled) and `id`.
 */
export function applyProfileFieldsToRule(
  rule: Rule,
  agent: AgentEntry,
  taskManager: TaskManagerEntry,
  backend: AgentBackend,
  options: { name?: string },
): Rule {
  return {
    ...rule,
    name: options.name ?? rule.name,
    trigger: {
      type: 'event',
      eventType: agent.sessionCompleteEventType,
    },
    mcpServers: [taskManager.mcpServerName],
    backend,
  };
}
