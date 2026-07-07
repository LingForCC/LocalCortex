/**
 * Zustand store for run history.
 */

import { create } from 'zustand';
import type { Run } from '@shared/types';

interface RunsState {
  runs: Run[];
  loading: boolean;
  /** Filter the run list by rule id (null = all). */
  filterRuleId: string | null;

  load: (ruleId?: string | null, limit?: number) => Promise<void>;
  setFilter: (ruleId: string | null) => void;
  trigger: (ruleId: string, eventPayload?: Record<string, unknown>) => Promise<number>;
}

export const useRunsStore = create<RunsState>((set, get) => ({
  runs: [],
  loading: false,
  filterRuleId: null,

  load: async (ruleId, limit = 100) => {
    set({ loading: true });
    const effectiveRuleId = ruleId !== undefined ? ruleId : get().filterRuleId;
    const runs = await window.api.runs.list(effectiveRuleId, limit);
    set({ runs, loading: false, filterRuleId: effectiveRuleId ?? null });
  },

  setFilter: (ruleId) => set({ filterRuleId: ruleId }),

  trigger: async (ruleId, eventPayload) => {
    const { runId } = await window.api.runs.trigger(ruleId, eventPayload);
    return runId;
  },
}));
