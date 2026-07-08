/**
 * Preload script — the ONLY bridge between the sandboxed renderer and the
 * privileged main process.
 *
 * Spec: docs/architecture.md §4 ("Renderer never touches Node/CLIs/filesystem").
 * Exposes a typed `window.api` via contextBridge; every method is an
 * `ipcRenderer.invoke` over a channel validated on the main side.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@shared/schemas/ipc-schema';
import type { Rule, Run, AppSettings, RuleWithBookkeeping } from '@shared/types';
import type { UpdateSettingsResult } from './ipc/settings.js';

const api = {
  rules: {
    list: (): Promise<RuleWithBookkeeping[]> => ipcRenderer.invoke(IPC.RULE_LIST),
    get: (id: string): Promise<RuleWithBookkeeping | null> =>
      ipcRenderer.invoke(IPC.RULE_GET, { id }),
    create: (rule: Rule): Promise<RuleWithBookkeeping | null> =>
      ipcRenderer.invoke(IPC.RULE_CREATE, rule),
    update: (rule: Rule): Promise<RuleWithBookkeeping | null> =>
      ipcRenderer.invoke(IPC.RULE_UPDATE, rule),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.RULE_DELETE, { id }),
    setEnabled: (id: string, enabled: boolean): Promise<boolean> =>
      ipcRenderer.invoke(IPC.RULE_SET_ENABLED, { id, enabled }),
  },
  runs: {
    list: (ruleId: string | null, limit = 100): Promise<Run[]> =>
      ipcRenderer.invoke(IPC.RUN_LIST, { ruleId, limit }),
    get: (id: number): Promise<Run | null> => ipcRenderer.invoke(IPC.RUN_GET, { id }),
    trigger: (ruleId: string, eventPayload?: Record<string, unknown>): Promise<{ runId: number }> =>
      ipcRenderer.invoke(IPC.RUN_TRIGGER, { ruleId, eventPayload }),
  },
  servers: {
    list: (): Promise<{ names: string[]; placeholders: string[] }> =>
      ipcRenderer.invoke(IPC.SERVERS_LIST),
    read: (): Promise<unknown> => ipcRenderer.invoke(IPC.SERVERS_READ),
    validate: (): Promise<{ ok: boolean; errors: string[] }> =>
      ipcRenderer.invoke(IPC.SERVERS_VALIDATE),
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
    update: (patch: Partial<AppSettings>): Promise<UpdateSettingsResult> =>
      ipcRenderer.invoke(IPC.SETTINGS_UPDATE, patch),
  },
  theme: {
    /**
     * Subscribe to the effective dark-mode state driven by `nativeTheme`
     * (which Settings → Appearance controls). The main process emits whenever
     * `nativeTheme.shouldUseDarkColors` changes; the renderer toggles the
     * `.dark` class on <html>. Returns an unsubscribe function.
     */
    onApply: (handler: (dark: boolean) => void): (() => void) => {
      const listener = (_evt: unknown, dark: boolean): void => handler(dark);
      ipcRenderer.on(IPC.THEME_APPLY, listener);
      return () => ipcRenderer.off(IPC.THEME_APPLY, listener);
    },
  },
};

export type LocalCortexApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
