/**
 * IPC handlers for the `rules:*` channels.
 *
 * Spec: docs/architecture.md §4 (ipc/rules.ts), docs/features/rules/README.md
 * (validation rules enforced before save).
 *
 * Each handler validates its incoming payload with a Zod schema, then calls the
 * repository. Validation that depends on external state (mcpServers existing in
 * mcp-servers.json) happens in the resolver at run time, not here — saves don't
 * require the config file to be present.
 */

import { ipcMain } from 'electron';
import {
  IPC,
  RuleIdSchema,
  CreateRuleMessageSchema,
  UpdateRuleMessageSchema,
  SetRuleEnabledMessageSchema,
} from '@shared/schemas/ipc-schema';
import type { RulesRepository } from '../db/repositories/rules.js';

export function registerRulesIpc(rulesRepo: RulesRepository): void {
  ipcMain.handle(IPC.RULE_LIST, async () => rulesRepo.list());

  ipcMain.handle(IPC.RULE_GET, async (_evt, raw) => {
    const { id } = RuleIdSchema.parse(raw);
    return rulesRepo.get(id);
  });

  ipcMain.handle(IPC.RULE_CREATE, async (_evt, raw) => {
    const rule = CreateRuleMessageSchema.parse(raw);
    rulesRepo.create(rule);
    return rulesRepo.get(rule.id);
  });

  ipcMain.handle(IPC.RULE_UPDATE, async (_evt, raw) => {
    const rule = UpdateRuleMessageSchema.parse(raw);
    rulesRepo.update(rule);
    return rulesRepo.get(rule.id);
  });

  ipcMain.handle(IPC.RULE_DELETE, async (_evt, raw) => {
    const { id } = RuleIdSchema.parse(raw);
    return rulesRepo.delete(id);
  });

  ipcMain.handle(IPC.RULE_SET_ENABLED, async (_evt, raw) => {
    const { id, enabled } = SetRuleEnabledMessageSchema.parse(raw);
    // Re-enabling resets the run counter (stop-conditions/README.md "Re-enabling").
    if (enabled) rulesRepo.resetRunCount(id);
    return rulesRepo.setEnabled(id, enabled);
  });
}
