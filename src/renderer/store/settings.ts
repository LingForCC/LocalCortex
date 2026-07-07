/**
 * Zustand store for global settings + MCP server status.
 */

import { create } from 'zustand';
import type { AppSettings } from '@shared/types';
import { DEFAULT_TICK_INTERVAL_SECONDS, DEFAULT_CONCURRENCY } from '@shared/constants';

interface SettingsState {
  settings: AppSettings;
  serverNames: string[];
  placeholders: string[];
  load: () => Promise<void>;
  update: (patch: Partial<AppSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: {
    tickIntervalSeconds: DEFAULT_TICK_INTERVAL_SECONDS,
    concurrency: DEFAULT_CONCURRENCY,
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
    const settings = await window.api.settings.update(patch);
    set({ settings });
  },
}));
