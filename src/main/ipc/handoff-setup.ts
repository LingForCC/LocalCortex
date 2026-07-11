/**
 * IPC handlers for `handoff-setup:complete` and `handoff-setup:reset`.
 *
 * Spec: docs/features/handoff-setup/README.md.
 *
 * `complete` is the atomic onboarding-finish step: validate the three choices
 * against the DB catalog → persist them to settings → create-or-update the
 * handoff rule (idempotent via HANDOFF_RULE_ID) → broadcast `rules:changed` so
 * the scheduler refreshes. `reset` clears the handoff settings so the user
 * re-enters onboarding.
 *
 * Returns structured results `{ ok, error?, … }` so the renderer can surface
 * failures inline without catching throws.
 */

import { ipcMain } from 'electron';
import { IPC, HandoffSetupCompleteSchema } from '@shared/schemas/ipc-schema';
import type { HandoffSetupResult } from '@shared/schemas/ipc-schema';
import type { SettingsRepository } from '../db/repositories/settings.js';
import type { AgentsRepository } from '../db/repositories/agents.js';
import type { TaskManagersRepository } from '../db/repositories/task-managers.js';
import type { RulesRepository } from '../db/repositories/rules.js';
import type { McpServersRepository } from '../db/repositories/mcp-servers.js';
import { buildHandoffRule, HANDOFF_RULE_ID } from '../handoff-setup/setup-builder.js';

export interface HandoffSetupIpcDeps {
  settingsRepo: SettingsRepository;
  agentsRepo: AgentsRepository;
  taskManagersRepo: TaskManagersRepository;
  rulesRepo: RulesRepository;
  mcpServersRepo: McpServersRepository;
  /** Broadcast after a rule mutation so the scheduler re-schedules. */
  onRulesChanged?: () => void;
}

export function registerHandoffSetupIpc(deps: HandoffSetupIpcDeps): void {
  ipcMain.handle(IPC.HANDOFF_SETUP_COMPLETE, async (_evt, raw): Promise<HandoffSetupResult> => {
    const parsed = HandoffSetupCompleteSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return { ok: false, error: `Invalid setup request: ${parsed.error.message}` };
    }
    const { agentId, taskManagerId, backend } = parsed.data;

    // Validate the choices against the DB catalog.
    const agent = deps.agentsRepo.get(agentId);
    if (!agent) {
      return { ok: false, error: `Unknown agent: '${agentId}'` };
    }
    const taskManager = deps.taskManagersRepo.get(taskManagerId);
    if (!taskManager) {
      return { ok: false, error: `Unknown task manager: '${taskManagerId}'` };
    }

    // Verify the task manager's MCP server exists in the DB.
    const server = deps.mcpServersRepo.getByName(taskManager.mcpServerName);
    if (!server) {
      return {
        ok: false,
        error: `Task manager '${taskManager.label}' references missing MCP server '${taskManager.mcpServerName}'. Add it in the Sources tab.`,
      };
    }

    // Build and persist the rule (create-or-update, idempotent by fixed id).
    const rule = buildHandoffRule(agent, taskManager, backend);
    const existing = deps.rulesRepo.get(rule.id);
    if (existing) {
      // Preserve the run count across re-setup; only the rule definition changes.
      deps.rulesRepo.update(rule);
    } else {
      deps.rulesRepo.create(rule);
    }

    // Persist the three choices + rule id in settings.
    const settings = deps.settingsRepo.update({
      handoffAgentId: agentId,
      handoffTaskManagerId: taskManagerId,
      handoffBackend: backend,
      handoffRuleId: HANDOFF_RULE_ID,
    });

    deps.onRulesChanged?.();

    return { ok: true, settings, rule: deps.rulesRepo.get(HANDOFF_RULE_ID) };
  });

  ipcMain.handle(IPC.HANDOFF_SETUP_RESET, async (): Promise<HandoffSetupResult> => {
    // Clear the handoff settings so onboarding is "incomplete" again. We do NOT
    // delete/disable the rule — the user may want to keep it; re-running setup
    // will overwrite it.
    const settings = deps.settingsRepo.clearHandoffFields();
    return { ok: true, settings };
  });
}
