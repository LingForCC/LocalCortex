import { describe, it, expect } from 'vitest';
import {
  enrichEventForSession,
  mergeEnrichment,
  prepareHandoffEnrichment,
  type HandoffLookup,
} from './handoff-enrichment.js';

/**
 * Build a fake repo backed by an in-memory map of sessionId → handoff.
 * `enabled` controls whether the handoff matches findEnabledBySessionId.
 */
function makeRepo(
  store: Record<string, Array<{ id: string; context: Record<string, string>; enabled: boolean }>>,
): HandoffLookup & { setEnabled: (sessionId: string, enabled: boolean) => void } {
  return {
    findEnabledBySessionId(sessionId: string) {
      const rows = store[sessionId];
      if (!rows) return null;
      const enabled = rows.find((r) => r.enabled);
      if (!enabled) return null;
      return { id: enabled.id, context: enabled.context };
    },
    setEnabled(sessionId: string, enabled: boolean) {
      const rows = store[sessionId];
      if (rows && rows[0]) rows[0].enabled = enabled;
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
      sess_other: [{ id: 'h1', context: { parentTaskId: 'x' }, enabled: true }],
    });
    expect(enrichEventForSession('sess_unknown', repo)).toBeNull();
  });

  it('returns the context + handoffId for an enabled handoff', () => {
    const repo = makeRepo({
      sess_a: [
        {
          id: 'h1',
          context: { parentTaskId: 'o2LOz5FWVIj', taskManager: 'omnifocus' },
          enabled: true,
        },
      ],
    });
    const result = enrichEventForSession('sess_a', repo);
    expect(result).toEqual({
      handoffId: 'h1',
      context: { parentTaskId: 'o2LOz5FWVIj', taskManager: 'omnifocus' },
    });
  });

  it('returns null for a disabled handoff', () => {
    const repo = makeRepo({
      sess_b: [{ id: 'h2', context: { parentTaskId: 'x' }, enabled: false }],
    });
    expect(enrichEventForSession('sess_b', repo)).toBeNull();
  });

  it('fires again after re-enabling (no fulfilled state)', () => {
    const repo = makeRepo({
      sess_c: [{ id: 'h3', context: { parentTaskId: 'x' }, enabled: true }],
    });
    // First event: matches.
    expect(enrichEventForSession('sess_c', repo)).not.toBeNull();
    // A second event for the same session still matches (fire-on-every-match).
    expect(enrichEventForSession('sess_c', repo)).not.toBeNull();
    // Disable → no match.
    repo.setEnabled('sess_c', false);
    expect(enrichEventForSession('sess_c', repo)).toBeNull();
    // Re-enable → matches again.
    repo.setEnabled('sess_c', true);
    expect(enrichEventForSession('sess_c', repo)).not.toBeNull();
  });

  it('returns a copy of the context (not the stored reference)', () => {
    const repo = makeRepo({
      sess_e: [{ id: 'h5', context: { parentTaskId: 'x' }, enabled: true }],
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
  /** An event with an open payload map (so enrichment keys are addressable). */
  type Ev = { type: string; payload: Record<string, unknown> };

  it('H-I1: no enabled handoff → event passes through unchanged', () => {
    const repo = makeRepo({});
    const event: Ev = { type: 'zcode.session-complete', payload: { sessionId: 'sess_unknown' } };
    const { event: out, matched, enrichment } = prepareHandoffEnrichment(event, repo);
    expect(out).toBe(event); // same reference — no enrichment
    expect(out.payload).toEqual({ sessionId: 'sess_unknown' });
    expect(matched).toBe(false);
    expect(enrichment).toBeNull();
  });

  it('H-I2: enabled handoff → context merged into payload', () => {
    const repo = makeRepo({
      sess_a: [
        {
          id: 'h1',
          context: { parentTaskId: 'o2LOz5FWVIj', taskManager: 'omnifocus' },
          enabled: true,
        },
      ],
    });
    const event: Ev = {
      type: 'zcode.session-complete',
      payload: { sessionId: 'sess_a', summary: 'done' },
    };
    const { event: out, matched, enrichment } = prepareHandoffEnrichment(event, repo);
    expect(matched).toBe(true);
    expect(out.payload['parentTaskId']).toBe('o2LOz5FWVIj');
    expect(out.payload['taskManager']).toBe('omnifocus');
    expect(enrichment).toEqual({
      handoffId: 'h1',
      context: { parentTaskId: 'o2LOz5FWVIj', taskManager: 'omnifocus' },
    });
  });

  it('H-I3: original payload keys preserved (merge, not replace)', () => {
    const repo = makeRepo({
      sess_b: [{ id: 'h2', context: { parentTaskId: 'x' }, enabled: true }],
    });
    const event: Ev = {
      type: 'zcode.session-complete',
      payload: { sessionId: 'sess_b', workdir: '/repo', summary: 'shipped' },
    };
    const { event: out } = prepareHandoffEnrichment(event, repo);
    expect(out.payload['workdir']).toBe('/repo');
    expect(out.payload['summary']).toBe('shipped');
    expect(out.payload['parentTaskId']).toBe('x');
  });

  it('H-I4: enrichment overrides a colliding payload key (context wins)', () => {
    const repo = makeRepo({
      sess_c: [{ id: 'h3', context: { parentTaskId: 'NEW' }, enabled: true }],
    });
    const event: Ev = { type: 'ev', payload: { sessionId: 'sess_c', parentTaskId: 'OLD' } };
    const { event: out } = prepareHandoffEnrichment(event, repo);
    expect(out.payload['parentTaskId']).toBe('NEW');
  });

  it('H-I5: fires on every call (no fulfilled state) — repeated matches all enrich', () => {
    const repo = makeRepo({
      sess_d: [{ id: 'h4', context: { parentTaskId: 'x' }, enabled: true }],
    });
    const event: Ev = { type: 'ev', payload: { sessionId: 'sess_d' } };
    // Three separate events for the same session — each must enrich.
    for (let i = 0; i < 3; i++) {
      const { matched } = prepareHandoffEnrichment(event, repo);
      expect(matched).toBe(true);
    }
  });

  it('H-I6: disabled handoff → no enrichment', () => {
    const repo = makeRepo({
      sess_e: [{ id: 'h5', context: { parentTaskId: 'x' }, enabled: false }],
    });
    const event: Ev = { type: 'ev', payload: { sessionId: 'sess_e' } };
    const { event: out, matched } = prepareHandoffEnrichment(event, repo);
    expect(matched).toBe(false);
    expect(out).toBe(event);
    expect(out.payload['parentTaskId']).toBeUndefined();
  });

  it('H-I6b: event without sessionId → no enrichment', () => {
    const repo = makeRepo({
      sess_f: [{ id: 'h6', context: { parentTaskId: 'x' }, enabled: true }],
    });
    const event: Ev = { type: 'ev', payload: { summary: 'no session here' } };
    const { matched } = prepareHandoffEnrichment(event, repo);
    expect(matched).toBe(false);
  });

  it('H-I6c: non-string sessionId (e.g. number) → treated as no session id', () => {
    const repo = makeRepo({
      sess_g: [{ id: 'h7', context: { parentTaskId: 'x' }, enabled: true }],
    });
    const event: Ev = { type: 'ev', payload: { sessionId: 12345 } };
    const { matched } = prepareHandoffEnrichment(event, repo);
    expect(matched).toBe(false);
  });

  // Regression guard: enrichment is event-type-agnostic — it keys only on
  // payload.sessionId. A prompt-submit event for a session with an enabled
  // handoff (e.g. a resume) MUST enrich too, since prompt-submit rules run the
  // same match/enqueue path as session-complete. Locks in the corrected
  // behavior so a future type-based exclusion doesn't silently pass.
  it('H-I7: enriches a prompt-submit event when an enabled handoff exists (resume case)', () => {
    const repo = makeRepo({
      sess_resume: [
        {
          id: 'h_resume',
          context: { parentTaskId: 'o2LO', taskManager: 'omnifocus' },
          enabled: true,
        },
      ],
    });
    const event: Ev = { type: 'zcode.prompt-submit', payload: { sessionId: 'sess_resume' } };
    const { event: out, matched, enrichment } = prepareHandoffEnrichment(event, repo);
    expect(matched).toBe(true);
    expect(out.payload['parentTaskId']).toBe('o2LO');
    expect(out.payload['taskManager']).toBe('omnifocus');
    expect(enrichment).not.toBeNull();
  });
});
