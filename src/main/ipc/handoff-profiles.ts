/**
 * IPC handlers for the `handoff-profiles:*` channels — CRUD over agent +
 * task-manager + backend "handoff profiles"
 * (docs/features/handoff-profiles/README.md).
 *
 * Each profile owns exactly one auto-created rule. This handler is the only
 * place that coordinates the two tables, maintaining these invariants:
 *   - **create** → build a fresh per-profile rule (UUID id), insert rule +
 *     profile.
 *   - **update** → patch only the profile-owned rule fields (trigger eventType,
 *     mcpServers, backend, name), preserving any user edits to prompt/model.
 *   - **setEnabled** → mirror the flag onto the owned rule (the scheduler fires
 *     rules, not profiles, so the rule's `enabled` is what counts).
 *   - **delete** → delete the rule first, then the profile. (The FK cascade
 *     only fires when the *parent* rule row is deleted; deleting the profile
 *     alone would orphan its rule.)
 *
 * Validates every choice against the DB catalog (agent exists, task manager
 * exists, task manager's MCP server exists). Returns structured `{ ok, error? }`
 * results so the renderer can surface failures inline without catching throws.
 * Every mutation broadcasts `onRulesChanged` so the scheduler re-schedules.
 */

import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { IPC } from '@shared/schemas/ipc-schema';
import {
  CreateHandoffProfileMessageSchema,
  UpdateHandoffProfileMessageSchema,
  SetHandoffProfileEnabledMessageSchema,
  HandoffProfileIdSchema,
} from '@shared/schemas/ipc-schema';
import type { HandoffProfile, CreateHandoffProfile, UpdateHandoffProfile } from '@shared/types';
import type { HandoffProfilesRepository } from '../db/repositories/handoff-profiles.js';
import type { AgentsRepository } from '../db/repositories/agents.js';
import type { TaskManagersRepository } from '../db/repositories/task-managers.js';
import type { RulesRepository } from '../db/repositories/rules.js';
import type { McpServersRepository } from '../db/repositories/mcp-servers.js';
import { buildHandoffProfileRule, applyProfileFieldsToRule } from '../handoff-profiles/profile-builder.js';

export interface HandoffProfilesIpcDeps {
  handoffProfilesRepo: HandoffProfilesRepository;
  agentsRepo: AgentsRepository;
  taskManagersRepo: TaskManagersRepository;
  rulesRepo: RulesRepository;
  mcpServersRepo: McpServersRepository;
  /** Broadcast after a rule mutation so the scheduler re-schedules. */
  onRulesChanged?: () => void;
}

/** Discriminated result for create/update/setEnabled. */
type HandoffProfileResult = { ok: true; handoffProfile: HandoffProfile } | { ok: false; error: string };

/** Error-only result (the shape returned on validation failures). */
type HandoffProfileError = { ok: false; error: string };

function ok(handoffProfile: HandoffProfile): HandoffProfileResult {
  return { ok: true, handoffProfile };
}
function err(error: string): HandoffProfileError {
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
  deps: HandoffProfilesIpcDeps,
  agentId: string,
  taskManagerId: string,
): { ok: true; agent: AgentEntryResolved; taskManager: TaskManagerEntryResolved } | HandoffProfileError {
  const agent = deps.agentsRepo.get(agentId);
  if (!agent) return err(`Unknown agent: '${agentId}'`);
  const taskManager = deps.taskManagersRepo.get(taskManagerId);
  if (!taskManager) return err(`Unknown task manager: '${taskManagerId}'`);
  // Verify the task manager's MCP server exists in the DB.
  const server = deps.mcpServersRepo.getByName(taskManager.mcpServerName);
  if (!server) {
    return err(
      `Task manager '${taskManager.label}' references missing MCP server '${taskManager.mcpServerName}'. Add it in the Sources tab.`,
    );
  }
  return { ok: true, agent, taskManager };
}

export function registerHandoffProfilesIpc(deps: HandoffProfilesIpcDeps): void {
  ipcMain.handle(IPC.HANDOFF_PROFILES_LIST, async (): Promise<HandoffProfile[]> => deps.handoffProfilesRepo.list());

  ipcMain.handle(IPC.HANDOFF_PROFILES_GET, async (_evt, raw): Promise<HandoffProfile | null> => {
    const parsed = HandoffProfileIdSchema.safeParse(raw ?? {});
    if (!parsed.success) return null;
    return deps.handoffProfilesRepo.get(parsed.data.id);
  });

  ipcMain.handle(IPC.HANDOFF_PROFILES_CREATE, async (_evt, raw): Promise<HandoffProfileResult> => {
    const parsed = CreateHandoffProfileMessageSchema.safeParse(raw ?? {});
    if (!parsed.success) return err(`Invalid handoff profile: ${parsed.error.message}`);
    const input: CreateHandoffProfile = parsed.data;

    const resolved = resolveChoices(deps, input.agentId, input.taskManagerId);
    if (!resolved.ok) return resolved;

    // Mint fresh ids for the profile and its rule.
    const profileId = randomUUID();
    const ruleId = randomUUID();
    const rule = buildHandoffProfileRule(
      resolved.agent,
      resolved.taskManager,
      input.backend,
      { id: ruleId, name: input.label },
    );
    deps.rulesRepo.create(rule);

    const now = new Date().toISOString();
    const handoffProfile: HandoffProfile = {
      id: profileId,
      label: input.label,
      agentId: input.agentId,
      taskManagerId: input.taskManagerId,
      backend: input.backend,
      ruleId,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    deps.handoffProfilesRepo.create(handoffProfile);
    deps.onRulesChanged?.();
    return ok(deps.handoffProfilesRepo.get(profileId)!);
  });

  ipcMain.handle(IPC.HANDOFF_PROFILES_UPDATE, async (_evt, raw): Promise<HandoffProfileResult> => {
    const parsed = UpdateHandoffProfileMessageSchema.safeParse(raw ?? {});
    if (!parsed.success) return err(`Invalid handoff profile update: ${parsed.error.message}`);
    const { id, payload }: { id: string; payload: UpdateHandoffProfile } = parsed.data;

    const existing = deps.handoffProfilesRepo.get(id);
    if (!existing) return err(`Handoff profile not found: '${id}'`);

    // Resolve the (possibly changed) agent/TM. If a field wasn't supplied,
    // fall back to the existing value so partial updates work.
    const agentId = payload.agentId ?? existing.agentId;
    const taskManagerId = payload.taskManagerId ?? existing.taskManagerId;
    const backend = payload.backend ?? existing.backend;
    const label = payload.label ?? existing.label;

    const resolved = resolveChoices(deps, agentId, taskManagerId);
    if (!resolved.ok) return resolved;

    // Patch only the profile-owned rule fields, preserving prompt/model edits.
    const ruleRow = deps.rulesRepo.get(existing.ruleId);
    if (ruleRow) {
      const updatedRule = applyProfileFieldsToRule(
        ruleRow,
        resolved.agent,
        resolved.taskManager,
        backend,
        { name: label },
      );
      deps.rulesRepo.update(updatedRule);
    }

    deps.handoffProfilesRepo.update(id, { label, agentId, taskManagerId, backend });
    deps.onRulesChanged?.();
    return ok(deps.handoffProfilesRepo.get(id)!);
  });

  ipcMain.handle(IPC.HANDOFF_PROFILES_SET_ENABLED, async (_evt, raw): Promise<HandoffProfileResult> => {
    const parsed = SetHandoffProfileEnabledMessageSchema.safeParse(raw ?? {});
    if (!parsed.success) return err(`Invalid request: ${parsed.error.message}`);
    const { id, enabled } = parsed.data;

    const existing = deps.handoffProfilesRepo.get(id);
    if (!existing) return err(`Handoff profile not found: '${id}'`);

    // Mirror onto the owned rule — the scheduler fires rules, not profiles.
    deps.rulesRepo.setEnabled(existing.ruleId, enabled);
    deps.handoffProfilesRepo.setEnabled(id, enabled);
    deps.onRulesChanged?.();
    return ok(deps.handoffProfilesRepo.get(id)!);
  });

  ipcMain.handle(IPC.HANDOFF_PROFILES_DELETE, async (_evt, raw): Promise<{ ok: boolean }> => {
    const parsed = HandoffProfileIdSchema.safeParse(raw ?? {});
    if (!parsed.success) return { ok: false };

    const existing = deps.handoffProfilesRepo.get(parsed.data.id);
    if (!existing) return { ok: false };

    // Delete the rule first (the FK cascade only fires when the parent rule row
    // is deleted; deleting the profile alone would orphan its rule).
    deps.rulesRepo.delete(existing.ruleId);
    deps.handoffProfilesRepo.delete(parsed.data.id);
    deps.onRulesChanged?.();
    return { ok: true };
  });
}
