/**
 * IPC handlers for the `runs:*` channels — run history + manual trigger.
 *
 * Spec: docs/architecture.md §4 (ipc/runs.ts).
 */

import { ipcMain } from 'electron';
import { IPC, ListRunsMessageSchema, TriggerRunMessageSchema } from '@shared/schemas/ipc-schema';
import type { RunsRepository } from '../db/repositories/runs.js';

export interface ManualTriggerFn {
  (ruleId: string, eventPayload?: Record<string, unknown>): Promise<number>;
}

/**
 * @param runsRepo history repository
 * @param triggerRun callback that enqueues a manual run (fed to the run-loop).
 */
export function registerRunsIpc(runsRepo: RunsRepository, triggerRun: ManualTriggerFn): void {
  ipcMain.handle(IPC.RUN_LIST, async (_evt, raw) => {
    const { ruleId, limit } = ListRunsMessageSchema.parse(raw ?? {});
    return runsRepo.list(ruleId ?? null, limit);
  });

  ipcMain.handle(IPC.RUN_GET, async (_evt, raw) => {
    const id = (raw as { id?: number })?.id;
    if (typeof id !== 'number') throw new Error('runs:get requires { id: number }');
    return runsRepo.get(id);
  });

  ipcMain.handle(IPC.RUN_TRIGGER, async (_evt, raw) => {
    const { ruleId, eventPayload } = TriggerRunMessageSchema.parse(raw);
    const runId = await triggerRun(ruleId, eventPayload);
    return { runId };
  });
}
