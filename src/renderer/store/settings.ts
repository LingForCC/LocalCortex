/**
 * Zustand store for global settings + MCP server status.
 */

import { create } from 'zustand';
import type { AppSettings } from '@shared/types';
import {
  DEFAULT_TICK_INTERVAL_SECONDS,
  DEFAULT_CONCURRENCY,
  DEFAULT_APPEARANCE,
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_REASONING_EFFORT,
} from '@shared/constants';

interface SettingsState {
  settings: AppSettings;
  serverNames: string[];
  placeholders: string[];
  load: () => Promise<void>;
  /**
   * Persist a partial settings update. Resolves to `undefined` on success or
   * an error message string when the main process rejects the update (e.g. an
   * invalid CLI path). The caller surfaces it; the store does not throw.
   */
  update: (patch: Partial<AppSettings>) => Promise<string | undefined>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: {
    tickIntervalSeconds: DEFAULT_TICK_INTERVAL_SECONDS,
    concurrency: DEFAULT_CONCURRENCY,
    appearance: DEFAULT_APPEARANCE,
    codexModel: DEFAULT_CODEX_MODEL,
    codexReasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
  },
  serverNames: [],
  placeholders: [],

  load: async () => {
    const [settings, servers] = await Promise.all([
      window.api.settings.get(),
      window.api.servers.list(),
    ]);
    set({
      settings,
      serverNames: servers.names,
      placeholders: servers.placeholders,
    });
  },

  update: async (patch) => {
    const result = await window.api.settings.update(patch);
    if (!result.ok) return result.error;
    set({ settings: result.settings });
    return undefined;
  },
}));
