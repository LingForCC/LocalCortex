/**
 * IPC handlers for the `settings:*` channels — global tick interval + concurrency.
 *
 * Spec: docs/architecture.md §6.4, §6.5.
 */

import { ipcMain } from 'electron';
import { IPC, UpdateSettingsMessageSchema } from '@shared/schemas/ipc-schema';
import type { SettingsRepository } from '../db/repositories/settings.js';

export function registerSettingsIpc(settingsRepo: SettingsRepository): void {
  ipcMain.handle(IPC.SETTINGS_GET, async () => settingsRepo.get());

  ipcMain.handle(IPC.SETTINGS_UPDATE, async (_evt, raw) => {
    const parsed = UpdateSettingsMessageSchema.parse(raw ?? {});
    // Build a clean Partial<AppSettings>: null ingressSecret → '' (clear).
    const patch: Parameters<SettingsRepository['update']>[0] = {};
    if (parsed.tickIntervalSeconds !== undefined)
      patch.tickIntervalSeconds = parsed.tickIntervalSeconds;
    if (parsed.concurrency !== undefined) patch.concurrency = parsed.concurrency;
    if (parsed.ingressSecret !== undefined) {
      patch.ingressSecret = parsed.ingressSecret ?? '';
    }
    return settingsRepo.update(patch);
  });
}
