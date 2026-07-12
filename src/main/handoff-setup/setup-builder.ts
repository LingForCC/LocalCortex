/**
 * Pure logic that builds the auto-created rule owned by a handoff combo.
 *
 * Spec: docs/features/handoff-setup/README.md.
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
 * One combo owns exactly one rule. Multiple combos can run in parallel — one
 * per agent source — because each rule listens to its agent's distinct
 * session-complete event type and the matcher fires every matching rule.
 */

import type { Rule, AgentBackend } from '@shared/types';
import type { AgentEntry, TaskManagerEntry } from '@shared/types';

/**
 * Stable id for the legacy singleton handoff rule. Kept only so the migration
 * (006_handoff_combos.sql) can copy a pre-existing setup into one combo row
 * reusing the same rule. New combos mint per-combo rule ids (UUIDs) via the
 * IPC layer.
 */
export const HANDOFF_RULE_ID = 'handoff-auto';

/** Recognizable default name for a combo's auto-created rule. */
export const HANDOFF_RULE_NAME = 'Handoff (auto-created)';

/**
 * The default natural-language prompt for the handoff rule. Instructs the agent
 * to create a review subtask under the parent task when a session completes,
 * using the task-manager MCP server. Renders `{{parentTaskId}}` and
 * {{parentTaskName}} from the handoff context merged into the event payload at
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
 * Build a new handoff Rule owned by a combo. The caller supplies the rule id
 * (a fresh UUID per combo), so each combo owns its own row independent of any
 * other combo.
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
  options: { id: string; name?: string },
): Rule {
  return {
    id: options.id,
    name: options.name ?? HANDOFF_RULE_NAME,
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
      `Auto-created by combo setup. Agent: ${agent.label}. ` +
      `Task manager: ${taskManager.label}. ` +
      `Edit freely — the combo keeps this rule's trigger/server/backend in sync and preserves your prompt/model edits.`,
  };
}

/**
 * Apply the combo-owned fields onto an existing rule, preserving everything the
 * user may have edited. Used when a combo is updated (agent / task manager /
 * backend / label changed): only the fields the combo owns are overwritten.
 *
 * Preserved user-editable fields:
 *   - `rule`        (prompt text)
 *   - `model` / `modelReasoningEffort` (per-rule Codex overrides)
 *   - `workdir`, `sandbox`, `maxRuns`, `expiresAt`, `notes`
 *
 * Also preserves bookkeeping that lives on the rule row but is managed by other
 * flows: `enabled` (mirrored from the combo via setEnabled) and `id`.
 */
export function applyComboFieldsToRule(
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
