/**
 * Zustand store for handoff profiles (agent + task-manager + backend) — the
 * renderer's app-level state for the handoff profile list.
 *
 * Mirrors store/handoffs.ts + store/rules.ts: loads via
 * window.api.handoffProfiles and exposes CRUD actions that call the main
 * process and refresh local state.
 */

import { create } from 'zustand';
import type { HandoffProfile, CreateHandoffProfile, UpdateHandoffProfile } from '@shared/types';

interface HandoffProfilesState {
  handoffProfiles: HandoffProfile[];
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  create: (input: CreateHandoffProfile) => Promise<string | null>;
  update: (id: string, payload: UpdateHandoffProfile) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
}

export const useHandoffProfilesStore = create<HandoffProfilesState>((set) => ({
  handoffProfiles: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const handoffProfiles = await window.api.handoffProfiles.list();
      set({ handoffProfiles, loading: false });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  /**
   * Create a handoff profile. Returns the new profile's id on success, or null
   * + sets `error` on failure (e.g. unknown agent / missing MCP server).
   */
  create: async (input) => {
    const result = await window.api.handoffProfiles.create(input);
    if (result.ok && result.handoffProfile) {
      set((s) => ({ handoffProfiles: [result.handoffProfile!, ...s.handoffProfiles], error: null }));
      return result.handoffProfile.id;
    }
    set({ error: result.error ?? 'Failed to create handoff profile' });
    return null;
  },

  update: async (id, payload) => {
    const result = await window.api.handoffProfiles.update(id, payload);
    if (result.ok && result.handoffProfile) {
      set((s) => ({
        handoffProfiles: s.handoffProfiles.map((p) => (p.id === id ? result.handoffProfile! : p)),
        error: null,
      }));
      return true;
    }
    set({ error: result.error ?? 'Failed to update handoff profile' });
    return false;
  },

  remove: async (id) => {
    await window.api.handoffProfiles.delete(id);
    set((s) => ({ handoffProfiles: s.handoffProfiles.filter((p) => p.id !== id) }));
  },

  setEnabled: async (id, enabled) => {
    const result = await window.api.handoffProfiles.setEnabled(id, enabled);
    if (result.ok && result.handoffProfile) {
      set((s) => ({
        handoffProfiles: s.handoffProfiles.map((p) => (p.id === id ? { ...p, enabled } : p)),
      }));
    }
  },
}));
