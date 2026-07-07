/**
 * Zustand store for rules — the renderer's app-level state for the rule list.
 *
 * Spec: docs/architecture.md §4 (renderer state = Zustand fed by synchronous
 * IPC; no React Query). The store loads via window.api.rules and exposes
 * CRUD actions that call the main process and refresh local state.
 */

import { create } from 'zustand';
import type { Rule, RuleWithBookkeeping } from '@shared/types';

interface RulesState {
  rules: RuleWithBookkeeping[];
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  create: (rule: Rule) => Promise<void>;
  update: (rule: Rule) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
}

export const useRulesStore = create<RulesState>((set) => ({
  rules: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const rules = await window.api.rules.list();
      set({ rules, loading: false });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  create: async (rule) => {
    const created = await window.api.rules.create(rule);
    if (created) set((s) => ({ rules: [...s.rules, created] }));
  },

  update: async (rule) => {
    const updated = await window.api.rules.update(rule);
    if (updated) {
      set((s) => ({ rules: s.rules.map((r) => (r.id === updated.id ? updated : r)) }));
    }
  },

  remove: async (id) => {
    await window.api.rules.delete(id);
    set((s) => ({ rules: s.rules.filter((r) => r.id !== id) }));
  },

  setEnabled: async (id, enabled) => {
    await window.api.rules.setEnabled(id, enabled);
    set((s) => ({
      rules: s.rules.map((r) => (r.id === id ? { ...r, enabled } : r)),
    }));
  },
}));
