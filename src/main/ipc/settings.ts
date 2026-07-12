/**
 * IPC handlers for the `settings:*` channels — global tick interval, concurrency,
 * ingress secret, and explicit CLI paths for the Codex / Claude Code backends.
 *
 * Spec: docs/architecture.md §6.4, §6.5, §6.5.1.
 */

import { ipcMain } from 'electron';
import { IPC, UpdateSettingsMessageSchema } from '@shared/schemas/ipc-schema';
import type { SettingsRepository } from '../db/repositories/settings.js';
import type { AppSettings } from '@shared/types';
import { isExecutablePath } from '../agent/cli-resolver.js';

/** Discriminated result returned over `settings:update`. */
export type UpdateSettingsResult =
  { ok: true; settings: AppSettings } | { ok: false; error: string };

/**
 * Optional hook invoked after a *successful* `settings:update`. The main
 * bootstrap uses it to re-apply `nativeTheme.themeSource` (and any other
 * side-effecting setting) so a Settings change takes effect immediately.
 */
type OnSettingsUpdated = (settings: AppSettings) => void;

export function registerSettingsIpc(
  settingsRepo: SettingsRepository,
  onUpdate?: OnSettingsUpdated,
): void {
  ipcMain.handle(IPC.SETTINGS_GET, async () => settingsRepo.get());

  ipcMain.handle(IPC.SETTINGS_UPDATE, async (_evt, raw): Promise<UpdateSettingsResult> => {
    const parsed = UpdateSettingsMessageSchema.parse(raw ?? {});

    // Validate any explicit CLI paths before persisting (arch §6.5.1). An empty
    // string is valid (means auto-detect / SDK default). Surface failures as a
    // structured result so the renderer can show them inline.
    if (parsed.codexCliPath !== undefined && parsed.codexCliPath !== null) {
      if (!isExecutablePath(parsed.codexCliPath)) {
        return {
          ok: false,
          error: `Codex CLI path does not exist or is not executable: "${parsed.codexCliPath}"`,
        };
      }
    }
    if (parsed.claudeCliPath !== undefined && parsed.claudeCliPath !== null) {
      if (!isExecutablePath(parsed.claudeCliPath)) {
        return {
          ok: false,
          error: `Claude Code CLI path does not exist or is not executable: "${parsed.claudeCliPath}"`,
        };
      }
    }

    // Build a clean Partial<AppSettings>: null → '' (clear) for the nullable
    // string fields.
    const patch: Parameters<SettingsRepository['update']>[0] = {};
    if (parsed.tickIntervalSeconds !== undefined)
      patch.tickIntervalSeconds = parsed.tickIntervalSeconds;
    if (parsed.concurrency !== undefined) patch.concurrency = parsed.concurrency;
    if (parsed.appearance !== undefined) patch.appearance = parsed.appearance;
    if (parsed.ingressSecret !== undefined) {
      patch.ingressSecret = parsed.ingressSecret ?? '';
    }
    if (parsed.codexCliPath !== undefined) {
      patch.codexCliPath = parsed.codexCliPath ?? '';
    }
    if (parsed.claudeCliPath !== undefined) {
      patch.claudeCliPath = parsed.claudeCliPath ?? '';
    }
    if (parsed.codexModel !== undefined) {
      patch.codexModel = parsed.codexModel ?? '';
    }
    if (parsed.codexReasoningEffort !== undefined && parsed.codexReasoningEffort !== null) {
      patch.codexReasoningEffort = parsed.codexReasoningEffort;
    }
    const settings = settingsRepo.update(patch);
    // Re-apply side-effecting settings (e.g. nativeTheme) on change.
    onUpdate?.(settings);
    return { ok: true, settings };
  });
}
