/**
 * Zustand store for combos (agent + task-manager + backend) — the renderer's
 * app-level state for the combo list.
 *
 * Mirrors store/handoffs.ts + store/rules.ts: loads via window.api.combos and
 * exposes CRUD actions that call the main process and refresh local state.
 */

import { create } from 'zustand';
import type { Combo, CreateCombo, UpdateCombo } from '@shared/types';

interface CombosState {
  combos: Combo[];
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  create: (input: CreateCombo) => Promise<string | null>;
  update: (id: string, payload: UpdateCombo) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
}

export const useCombosStore = create<CombosState>((set) => ({
  combos: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const combos = await window.api.combos.list();
      set({ combos, loading: false });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  /**
   * Create a combo. Returns the new combo's id on success, or null + sets
   * `error` on failure (e.g. unknown agent / missing MCP server).
   */
  create: async (input) => {
    const result = await window.api.combos.create(input);
    if (result.ok && result.combo) {
      set((s) => ({ combos: [result.combo!, ...s.combos], error: null }));
      return result.combo.id;
    }
    set({ error: result.error ?? 'Failed to create combo' });
    return null;
  },

  update: async (id, payload) => {
    const result = await window.api.combos.update(id, payload);
    if (result.ok && result.combo) {
      set((s) => ({
        combos: s.combos.map((c) => (c.id === id ? result.combo! : c)),
        error: null,
      }));
      return true;
    }
    set({ error: result.error ?? 'Failed to update combo' });
    return false;
  },

  remove: async (id) => {
    await window.api.combos.delete(id);
    set((s) => ({ combos: s.combos.filter((c) => c.id !== id) }));
  },

  setEnabled: async (id, enabled) => {
    const result = await window.api.combos.setEnabled(id, enabled);
    if (result.ok && result.combo) {
      set((s) => ({
        combos: s.combos.map((c) => (c.id === id ? { ...c, enabled } : c)),
      }));
    }
  },
}));
