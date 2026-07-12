/**
 * IPC handlers for the `combos:*` channels — CRUD over agent + task-manager +
 * backend "combos" (docs/features/handoff-setup/README.md).
 *
 * Each combo owns exactly one auto-created rule. This handler is the only place
 * that coordinates the two tables, maintaining these invariants:
 *   - **create** → build a fresh per-combo rule (UUID id), insert rule + combo.
 *   - **update** → patch only the combo-owned rule fields (trigger eventType,
 *     mcpServers, backend, name), preserving any user edits to prompt/model.
 *   - **setEnabled** → mirror the flag onto the owned rule (the scheduler fires
 *     rules, not combos, so the rule's `enabled` is what counts).
 *   - **delete** → delete the rule first, then the combo. (The FK cascade only
 *     fires when the *parent* rule row is deleted; deleting the combo alone
 *     would orphan its rule.)
 *
 * Validates every choice against the DB catalog (agent exists, task manager
 * exists, task manager's MCP server exists) — same guards the old handoff-setup
 * handler used. Returns structured `{ ok, error? }` results so the renderer can
 * surface failures inline without catching throws. Every mutation broadcasts
 * `onRulesChanged` so the scheduler re-schedules.
 */

import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { IPC } from '@shared/schemas/ipc-schema';
import {
  CreateComboMessageSchema,
  UpdateComboMessageSchema,
  SetComboEnabledMessageSchema,
  ComboIdSchema,
} from '@shared/schemas/ipc-schema';
import type { Combo, CreateCombo, UpdateCombo } from '@shared/types';
import type { CombosRepository } from '../db/repositories/combos.js';
import type { AgentsRepository } from '../db/repositories/agents.js';
import type { TaskManagersRepository } from '../db/repositories/task-managers.js';
import type { RulesRepository } from '../db/repositories/rules.js';
import type { McpServersRepository } from '../db/repositories/mcp-servers.js';
import { buildHandoffRule, applyComboFieldsToRule } from '../handoff-setup/setup-builder.js';

export interface CombosIpcDeps {
  combosRepo: CombosRepository;
  agentsRepo: AgentsRepository;
  taskManagersRepo: TaskManagersRepository;
  rulesRepo: RulesRepository;
  mcpServersRepo: McpServersRepository;
  /** Broadcast after a rule mutation so the scheduler re-schedules. */
  onRulesChanged?: () => void;
}

/** Discriminated result for create/update/setEnabled. */
type ComboResult = { ok: true; combo: Combo } | { ok: false; error: string };

/** Error-only result (the shape returned on validation failures). */
type ComboError = { ok: false; error: string };

function ok(combo: Combo): ComboResult {
  return { ok: true, combo };
}
function err(error: string): ComboError {
  return { ok: false, error };
}

/**
 * Resolve + validate the catalog choices against the DB. Shared by create and
 * update. Returns the agent/task-manager entries on success, or an error-only
 * result. The success branch carries `agent`/`taskManager` so callers don't
 * need to re-fetch.
 */
type AgentEntryResolved = NonNullable<ReturnType<AgentsRepository['get']>>;
type TaskManagerEntryResolved = NonNullable<ReturnType<TaskManagersRepository['get']>>;
function resolveChoices(
  deps: CombosIpcDeps,
  agentId: string,
  taskManagerId: string,
): { ok: true; agent: AgentEntryResolved; taskManager: TaskManagerEntryResolved } | ComboError {
  const agent = deps.agentsRepo.get(agentId);
  if (!agent) return err(`Unknown agent: '${agentId}'`);
  const taskManager = deps.taskManagersRepo.get(taskManagerId);
  if (!taskManager) return err(`Unknown task manager: '${taskManagerId}'`);
  // Verify the task manager's MCP server exists in the DB (same guard as the
  // old handoff-setup handler).
  const server = deps.mcpServersRepo.getByName(taskManager.mcpServerName);
  if (!server) {
    return err(
      `Task manager '${taskManager.label}' references missing MCP server '${taskManager.mcpServerName}'. Add it in the Sources tab.`,
    );
  }
  return { ok: true, agent, taskManager };
}

export function registerCombosIpc(deps: CombosIpcDeps): void {
  ipcMain.handle(IPC.COMBOS_LIST, async (): Promise<Combo[]> => deps.combosRepo.list());

  ipcMain.handle(IPC.COMBOS_GET, async (_evt, raw): Promise<Combo | null> => {
    const parsed = ComboIdSchema.safeParse(raw ?? {});
    if (!parsed.success) return null;
    return deps.combosRepo.get(parsed.data.id);
  });

  ipcMain.handle(IPC.COMBOS_CREATE, async (_evt, raw): Promise<ComboResult> => {
    const parsed = CreateComboMessageSchema.safeParse(raw ?? {});
    if (!parsed.success) return err(`Invalid combo: ${parsed.error.message}`);
    const input: CreateCombo = parsed.data;

    const resolved = resolveChoices(deps, input.agentId, input.taskManagerId);
    if (!resolved.ok) return resolved;

    // Mint fresh ids for the combo and its rule.
    const comboId = randomUUID();
    const ruleId = randomUUID();
    const rule = buildHandoffRule(
      resolved.agent,
      resolved.taskManager,
      input.backend,
      { id: ruleId, name: input.label },
    );
    deps.rulesRepo.create(rule);

    const now = new Date().toISOString();
    const combo: Combo = {
      id: comboId,
      label: input.label,
      agentId: input.agentId,
      taskManagerId: input.taskManagerId,
      backend: input.backend,
      ruleId,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    deps.combosRepo.create(combo);
    deps.onRulesChanged?.();
    return ok(deps.combosRepo.get(comboId)!);
  });

  ipcMain.handle(IPC.COMBOS_UPDATE, async (_evt, raw): Promise<ComboResult> => {
    const parsed = UpdateComboMessageSchema.safeParse(raw ?? {});
    if (!parsed.success) return err(`Invalid combo update: ${parsed.error.message}`);
    const { id, payload }: { id: string; payload: UpdateCombo } = parsed.data;

    const existing = deps.combosRepo.get(id);
    if (!existing) return err(`Combo not found: '${id}'`);

    // Resolve the (possibly changed) agent/TM. If a field wasn't supplied,
    // fall back to the existing value so partial updates work.
    const agentId = payload.agentId ?? existing.agentId;
    const taskManagerId = payload.taskManagerId ?? existing.taskManagerId;
    const backend = payload.backend ?? existing.backend;
    const label = payload.label ?? existing.label;

    const resolved = resolveChoices(deps, agentId, taskManagerId);
    if (!resolved.ok) return resolved;

    // Patch only the combo-owned rule fields, preserving prompt/model edits.
    const ruleRow = deps.rulesRepo.get(existing.ruleId);
    if (ruleRow) {
      const updatedRule = applyComboFieldsToRule(
        ruleRow,
        resolved.agent,
        resolved.taskManager,
        backend,
        { name: label },
      );
      deps.rulesRepo.update(updatedRule);
    }

    deps.combosRepo.update(id, { label, agentId, taskManagerId, backend });
    deps.onRulesChanged?.();
    return ok(deps.combosRepo.get(id)!);
  });

  ipcMain.handle(IPC.COMBOS_SET_ENABLED, async (_evt, raw): Promise<ComboResult> => {
    const parsed = SetComboEnabledMessageSchema.safeParse(raw ?? {});
    if (!parsed.success) return err(`Invalid request: ${parsed.error.message}`);
    const { id, enabled } = parsed.data;

    const existing = deps.combosRepo.get(id);
    if (!existing) return err(`Combo not found: '${id}'`);

    // Mirror onto the owned rule — the scheduler fires rules, not combos.
    deps.rulesRepo.setEnabled(existing.ruleId, enabled);
    deps.combosRepo.setEnabled(id, enabled);
    deps.onRulesChanged?.();
    return ok(deps.combosRepo.get(id)!);
  });

  ipcMain.handle(IPC.COMBOS_DELETE, async (_evt, raw): Promise<{ ok: boolean }> => {
    const parsed = ComboIdSchema.safeParse(raw ?? {});
    if (!parsed.success) return { ok: false };

    const existing = deps.combosRepo.get(parsed.data.id);
    if (!existing) return { ok: false };

    // Delete the rule first (the FK cascade only fires when the parent rule row
    // is deleted; deleting the combo alone would orphan its rule).
    deps.rulesRepo.delete(existing.ruleId);
    deps.combosRepo.delete(parsed.data.id);
    deps.onRulesChanged?.();
    return { ok: true };
  });
}
