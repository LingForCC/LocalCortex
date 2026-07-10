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
import type { HandoffPromptPayload } from '@shared/schemas/ipc-schema';
import type { Rule, Run, AppSettings, RuleWithBookkeeping, Handoff } from '@shared/types';
import type { CreateHandoff } from '@shared/schemas/handoff-schema';
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
  handoffs: {
    list: (): Promise<Handoff[]> => ipcRenderer.invoke(IPC.HANDOFF_LIST),
    get: (id: string): Promise<Handoff | null> => ipcRenderer.invoke(IPC.HANDOFF_GET, { id }),
    create: (input: CreateHandoff): Promise<Handoff | null> =>
      ipcRenderer.invoke(IPC.HANDOFF_CREATE, input),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.HANDOFF_DELETE, { id }),
    setEnabled: (id: string, enabled: boolean): Promise<boolean> =>
      ipcRenderer.invoke(IPC.HANDOFF_SET_ENABLED, { id, enabled }),

    /**
     * Subscribe to prompt-submit prompts (main → renderer push). When a
     * `*.prompt-submit` event arrives, the main process opens a popup window
     * and pushes a `HandoffPromptPayload`; the popup renders the attach form
     * (new session) or enable/disable toggle (existing session). Returns an
     * unsubscribe function. Mirrors the `theme.onApply` pattern.
     */
    onPrompt: (handler: (payload: HandoffPromptPayload) => void): (() => void) => {
      const listener = (_evt: unknown, payload: HandoffPromptPayload): void => handler(payload);
      ipcRenderer.on(IPC.HANDOFF_PROMPT_PUSH, listener);
      return () => ipcRenderer.off(IPC.HANDOFF_PROMPT_PUSH, listener);
    },
    /**
     * Subscribe to handoff-change notifications (main → renderer push). Fires
     * after any create/delete/setEnabled so a window that didn't originate the
     * change can refresh its list — e.g. the main Handoffs panel updating when
     * a handoff is attached from the popup. Returns an unsubscribe function.
     */
    onChanged: (handler: () => void): (() => void) => {
      const listener = (): void => handler();
      ipcRenderer.on(IPC.HANDOFFS_CHANGED, listener);
      return () => ipcRenderer.off(IPC.HANDOFFS_CHANGED, listener);
    },
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
