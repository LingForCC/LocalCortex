/**
 * Pure logic that builds the auto-created handoff rule from onboarding choices.
 *
 * Spec: docs/features/handoff-setup/README.md.
 *
 * This module is Electron-free and side-effect-free, so it's unit-testable in
 * plain Vitest (the "factor logic out of Electron" rule, docs/tech-stack.md §5).
 * It takes catalog entries (from the DB) + a backend choice and returns a `Rule`
 * object; the IPC handler owns the persistence side effects.
 *
 * The three choices are orthogonal:
 *   - agent        → the event *source* (which eventType the rule listens to)
 *   - taskManager  → the sink (which MCP server the rule uses)
 *   - backend      → which runner fulfills the rule (Claude/Codex SDK)
 */

import type { Rule, AgentBackend } from '@shared/types';
import type { AgentEntry, TaskManagerEntry } from '@shared/types';

/**
 * Stable id for the auto-created handoff rule. Using a fixed id (not a random
 * UUID) makes setup idempotent: re-running onboarding updates the same row
 * rather than creating duplicates. Stored in settings.handoffRuleId as a cross-
 * check, but the id itself is deterministic.
 */
export const HANDOFF_RULE_ID = 'handoff-auto';

/** Stable, recognizable name for the auto-created rule. */
export const HANDOFF_RULE_NAME = 'Handoff (auto-created)';

/**
 * The default natural-language prompt for the handoff rule. Instructs the agent
 * to create a review subtask under the parent task when a session completes,
 * using the task-manager MCP server. Renders `{{parentTaskId}}` and
 * `{{parentTaskName}}` from the handoff context merged into the event payload at
 * enrichment time. No-ops when no parentTaskId is present (a handoff wasn't
 * attached for this session).
 */
export const DEFAULT_HANDOFF_RULE_TEXT = `You are a task-management assistant. When a coding agent session completes, create a review subtask so the user remembers to review the agent's work.

Steps:
1. Read the parent task id from {{parentTaskId}}. If it is empty, output the status block with status=active and reason="no parent task" — do nothing else.
2. Using the available MCP task-manager server, create a new subtask (or follow-up task) under {{parentTaskId}}. Use {{parentTaskName}} for context if available.
3. The subtask should remind the user to review the completed work. Title it something like "Review: {{parentTaskName}}".

Always end with a status block:
<status>
status: active | done | error
reason: <one line>
</status>`;

/**
 * Build the canonical handoff Rule from the three onboarding choices.
 *
 * The rule:
 *   - listens to the agent's session-complete event type
 *   - runs on the independently-chosen backend
 *   - uses the task manager's MCP server
 *   - is read-only (MCP tool calls aren't filesystem writes)
 *   - has the default review-subtask prompt
 */
export function buildHandoffRule(
  agent: AgentEntry,
  taskManager: TaskManagerEntry,
  backend: AgentBackend,
): Rule {
  return {
    id: HANDOFF_RULE_ID,
    name: HANDOFF_RULE_NAME,
    enabled: true,
    rule: DEFAULT_HANDOFF_RULE_TEXT,
    trigger: {
      type: 'event',
      eventType: agent.sessionCompleteEventType,
    },
    mcpServers: [taskManager.mcpServerName],
    backend,
    sandbox: 'read-only',
    notes:
      `Auto-created by handoff setup. Agent: ${agent.label}. ` +
      `Task manager: ${taskManager.label}. ` +
      `Edit freely — re-running setup will overwrite this rule.`,
  };
}
