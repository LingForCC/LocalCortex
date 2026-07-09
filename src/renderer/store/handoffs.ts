/**
 * Zustand store for handoffs (pending reviews) — the renderer's app-level
 * state for the handoff list.
 *
 * Mirrors store/rules.ts: loads via window.api.handoffs and exposes CRUD
 * actions that call the main process and refresh local state.
 */

import { create } from 'zustand';
import type { Handoff } from '@shared/types';
import type { CreateHandoff } from '@shared/schemas/handoff-schema';

interface HandoffsState {
  handoffs: Handoff[];
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  create: (input: CreateHandoff) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
}

export const useHandoffsStore = create<HandoffsState>((set) => ({
  handoffs: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const handoffs = await window.api.handoffs.list();
      set({ handoffs, loading: false });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  create: async (input) => {
    const created = await window.api.handoffs.create(input);
    if (created) set((s) => ({ handoffs: [created, ...s.handoffs] }));
  },

  remove: async (id) => {
    await window.api.handoffs.delete(id);
    set((s) => ({ handoffs: s.handoffs.filter((h) => h.id !== id) }));
  },

  setEnabled: async (id, enabled) => {
    await window.api.handoffs.setEnabled(id, enabled);
    set((s) => ({
      handoffs: s.handoffs.map((h) => (h.id === id ? { ...h, enabled } : h)),
    }));
  },
}));
