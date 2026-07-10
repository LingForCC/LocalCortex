/**
 * IPC handlers for the `handoffs:*` channels (pending reviews).
 *
 * Mirrors the `rules` IPC pattern (ipc/rules.ts): each handler validates its
 * payload with a Zod schema, then calls the repository.
 *
 * `create` mints a UUID id (the renderer-supplied payload has no id) and
 * returns the freshly-read canonical row so the renderer store can append it.
 *
 * `onChanged` (optional) fires after any mutation (create/delete/setEnabled)
 * so windows other than the one that originated the change can refresh —
 * notably the main window's Handoffs list when a handoff is created/toggled
 * from the prompt-submit popup window.
 */

import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import {
  IPC,
  HandoffIdSchema,
  CreateHandoffMessageSchema,
  SetHandoffEnabledMessageSchema,
} from '@shared/schemas/ipc-schema';
import type { HandoffsRepository } from '../db/repositories/handoffs.js';
import type { Handoff } from '@shared/types';

export function registerHandoffsIpc(
  handoffsRepo: HandoffsRepository,
  onChanged?: () => void,
): void {
  ipcMain.handle(IPC.HANDOFF_LIST, async () => handoffsRepo.list());

  ipcMain.handle(IPC.HANDOFF_GET, async (_evt, raw) => {
    const { id } = HandoffIdSchema.parse(raw);
    return handoffsRepo.get(id);
  });

  ipcMain.handle(IPC.HANDOFF_CREATE, async (_evt, raw) => {
    const input = CreateHandoffMessageSchema.parse(raw);
    const now = new Date().toISOString();
    const handoff: Handoff = {
      id: randomUUID(),
      sessionId: input.sessionId,
      context: input.context,
      reminderTitle: input.reminderTitle,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    handoffsRepo.create(handoff);
    onChanged?.();
    return handoffsRepo.get(handoff.id);
  });

  ipcMain.handle(IPC.HANDOFF_DELETE, async (_evt, raw) => {
    const { id } = HandoffIdSchema.parse(raw);
    const removed = handoffsRepo.delete(id);
    if (removed) onChanged?.();
    return removed;
  });

  ipcMain.handle(IPC.HANDOFF_SET_ENABLED, async (_evt, raw) => {
    const { id, enabled } = SetHandoffEnabledMessageSchema.parse(raw);
    const updated = handoffsRepo.setEnabled(id, enabled);
    if (updated) onChanged?.();
    return updated;
  });
}
