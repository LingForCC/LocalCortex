import { describe, it, expect, vi } from 'vitest';
import {
  enrichEventForSession,
  mergeEnrichment,
  prepareHandoffEnrichment,
  type HandoffLookup,
} from './handoff-enrichment.js';

/** Build a fake repo backed by an in-memory map of sessionId → handoff. */
function makeRepo(
  store: Record<string, Array<{ id: string; context: Record<string, string>; status: string }>>,
): HandoffLookup & { mark: (sessionId: string, status: string) => void } {
  return {
    findPendingBySessionId(sessionId: string) {
      const rows = store[sessionId];
      if (!rows) return null;
      const pending = rows.find((r) => r.status === 'pending');
      if (!pending) return null;
      return { id: pending.id, context: pending.context };
    },
    mark(sessionId: string, status: string) {
      const rows = store[sessionId];
      if (rows && rows[0]) rows[0].status = status;
    },
  };
}

describe('enrichEventForSession', () => {
  it('returns null when sessionId is undefined', () => {
    const repo = makeRepo({});
    expect(enrichEventForSession(undefined, repo)).toBeNull();
  });

  it('returns null when sessionId is empty', () => {
    const repo = makeRepo({});
    expect(enrichEventForSession('', repo)).toBeNull();
  });

  it('returns null when no handoff exists for the session', () => {
    const repo = makeRepo({
      sess_other: [{ id: 'h1', context: { parentTaskId: 'x' }, status: 'pending' }],
    });
    expect(enrichEventForSession('sess_unknown', repo)).toBeNull();
  });

  it('returns the context + handoffId for a pending handoff', () => {
    const repo = makeRepo({
      sess_a: [
        {
          id: 'h1',
          context: { parentTaskId: 'o2LOz5FWVIj', taskManager: 'omnifocus' },
          status: 'pending',
        },
      ],
    });
    const result = enrichEventForSession('sess_a', repo);
    expect(result).toEqual({
      handoffId: 'h1',
      context: { parentTaskId: 'o2LOz5FWVIj', taskManager: 'omnifocus' },
    });
  });

  it('returns null for a fulfilled handoff (idempotent — does not re-fire)', () => {
    const repo = makeRepo({
      sess_b: [{ id: 'h2', context: { parentTaskId: 'x' }, status: 'fulfilled' }],
    });
    expect(enrichEventForSession('sess_b', repo)).toBeNull();
  });

  it('returns null for a cancelled handoff', () => {
    const repo = makeRepo({
      sess_c: [{ id: 'h3', context: { parentTaskId: 'x' }, status: 'cancelled' }],
    });
    expect(enrichEventForSession('sess_c', repo)).toBeNull();
  });

  it('does not re-fire after the handoff is marked fulfilled', () => {
    const repo = makeRepo({
      sess_d: [{ id: 'h4', context: { parentTaskId: 'x' }, status: 'pending' }],
    });
    expect(enrichEventForSession('sess_d', repo)).not.toBeNull();
    // Simulate the run completing and marking the handoff fulfilled.
    repo.mark('sess_d', 'fulfilled');
    expect(enrichEventForSession('sess_d', repo)).toBeNull();
  });

  it('returns a copy of the context (not the stored reference)', () => {
    const repo = makeRepo({
      sess_e: [{ id: 'h5', context: { parentTaskId: 'x' }, status: 'pending' }],
    });
    const result = enrichEventForSession('sess_e', repo);
    expect(result).not.toBeNull();
    result!.context['newKey'] = 'mutated';
    // The mutation must not leak back into a fresh lookup.
    const again = enrichEventForSession('sess_e', repo);
    expect(again!.context['newKey']).toBeUndefined();
  });
});

describe('mergeEnrichment', () => {
  it('returns the payload unchanged when enrichment is null', () => {
    const payload = { sessionId: 's1', foo: 'bar' };
    expect(mergeEnrichment(payload, null)).toBe(payload);
  });

  it('merges enrichment keys into the payload', () => {
    const payload = { sessionId: 's1', summary: 'done' };
    const merged = mergeEnrichment(payload, { parentTaskId: 'o2LO', taskManager: 'omnifocus' });
    expect(merged).toEqual({
      sessionId: 's1',
      summary: 'done',
      parentTaskId: 'o2LO',
      taskManager: 'omnifocus',
    });
  });

  it('enrichment overrides existing payload keys (handoff context wins)', () => {
    const payload = { sessionId: 's1', parentTaskId: 'OLD' };
    const merged = mergeEnrichment(payload, { parentTaskId: 'NEW' });
    expect(merged['parentTaskId']).toBe('NEW');
  });
});

describe('prepareHandoffEnrichment (composition)', () => {
  // The orchestrator takes an event, a lookup repo, and a markFulfilled spy.
  function setup(store: Parameters<typeof makeRepo>[0]) {
    const repo = makeRepo(store);
    const markFulfilled = vi.fn<(id: string, runId: number, ruleId?: string) => boolean>();
    return { repo, markFulfilled };
  }

  /** An event with an open payload map (so enrichment keys are addressable). */
  type Ev = { type: string; payload: Record<string, unknown> };

  it('H-I1: no pending handoff → event passes through unchanged, no fulfillment', () => {
    const { repo, markFulfilled } = setup({});
    const event: Ev = { type: 'zcode.session-complete', payload: { sessionId: 'sess_unknown' } };
    const { event: out, matched, onFulfilled } = prepareHandoffEnrichment(
      event,
      repo,
      markFulfilled,
    );
    expect(out).toBe(event); // same reference — no enrichment
    expect(out.payload).toEqual({ sessionId: 'sess_unknown' });
    expect(matched).toBe(false);
    onFulfilled(1, 'rule-1');
    expect(markFulfilled).not.toHaveBeenCalled();
  });

  it('H-I2: pending handoff → context merged into payload', () => {
    const { repo, markFulfilled } = setup({
      sess_a: [
        {
          id: 'h1',
          context: { parentTaskId: 'o2LOz5FWVIj', taskManager: 'omnifocus' },
          status: 'pending',
        },
      ],
    });
    const event: Ev = {
      type: 'zcode.session-complete',
      payload: { sessionId: 'sess_a', summary: 'done' },
    };
    const { event: out, matched } = prepareHandoffEnrichment(event, repo, markFulfilled);
    expect(matched).toBe(true);
    expect(out.payload['parentTaskId']).toBe('o2LOz5FWVIj');
    expect(out.payload['taskManager']).toBe('omnifocus');
  });

  it('H-I3: original payload keys preserved (merge, not replace)', () => {
    const { repo, markFulfilled } = setup({
      sess_b: [{ id: 'h2', context: { parentTaskId: 'x' }, status: 'pending' }],
    });
    const event: Ev = {
      type: 'zcode.session-complete',
      payload: { sessionId: 'sess_b', workdir: '/repo', summary: 'shipped' },
    };
    const { event: out } = prepareHandoffEnrichment(event, repo, markFulfilled);
    expect(out.payload['workdir']).toBe('/repo');
    expect(out.payload['summary']).toBe('shipped');
    expect(out.payload['parentTaskId']).toBe('x');
  });

  it('H-I4: enrichment overrides a colliding payload key (context wins)', () => {
    const { repo, markFulfilled } = setup({
      sess_c: [{ id: 'h3', context: { parentTaskId: 'NEW' }, status: 'pending' }],
    });
    const event: Ev = { type: 'ev', payload: { sessionId: 'sess_c', parentTaskId: 'OLD' } };
    const { event: out } = prepareHandoffEnrichment(event, repo, markFulfilled);
    expect(out.payload['parentTaskId']).toBe('NEW');
  });

  it('H-I5: onFulfilled marks the handoff with the run id + rule id', () => {
    const { repo, markFulfilled } = setup({
      sess_d: [{ id: 'h4', context: { parentTaskId: 'x' }, status: 'pending' }],
    });
    const event = { type: 'ev', payload: { sessionId: 'sess_d' } };
    const { onFulfilled } = prepareHandoffEnrichment(event, repo, markFulfilled);
    onFulfilled(42, 'rule-x');
    expect(markFulfilled).toHaveBeenCalledWith('h4', 42, 'rule-x');
  });

  it('H-I5b: ruleId omitted from onFulfilled → markFulfilled called without it', () => {
    const { repo, markFulfilled } = setup({
      sess_e: [{ id: 'h5', context: { parentTaskId: 'x' }, status: 'pending' }],
    });
    const event = { type: 'ev', payload: { sessionId: 'sess_e' } };
    const { onFulfilled } = prepareHandoffEnrichment(event, repo, markFulfilled);
    onFulfilled(7);
    expect(markFulfilled).toHaveBeenCalledWith('h5', 7, undefined);
  });

  it('H-I6: event without sessionId → no enrichment, no fulfillment', () => {
    const { repo, markFulfilled } = setup({
      sess_f: [{ id: 'h6', context: { parentTaskId: 'x' }, status: 'pending' }],
    });
    const event: Ev = { type: 'ev', payload: { summary: 'no session here' } };
    const { event: out, matched, onFulfilled } = prepareHandoffEnrichment(
      event,
      repo,
      markFulfilled,
    );
    expect(matched).toBe(false);
    expect(out).toBe(event);
    expect(out.payload['parentTaskId']).toBeUndefined();
    onFulfilled(1);
    expect(markFulfilled).not.toHaveBeenCalled();
  });

  it('H-I6b: non-string sessionId (e.g. number) → treated as no session id', () => {
    const { repo, markFulfilled } = setup({
      sess_g: [{ id: 'h7', context: { parentTaskId: 'x' }, status: 'pending' }],
    });
    const event = { type: 'ev', payload: { sessionId: 12345 } };
    const { matched } = prepareHandoffEnrichment(event, repo, markFulfilled);
    expect(matched).toBe(false);
  });
});
