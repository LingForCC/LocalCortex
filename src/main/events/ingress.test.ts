import { describe, it, expect } from 'vitest';
import { buildIngress } from './ingress.js';
import type { IncomingEvent, Rule } from '@shared/types';

/**
 * Exercise the ingress HTTP path via fastify's in-process `inject` so no real
 * port is bound. Mirrors how the ingress is built in production
 * (startIngress → buildIngress) but without listening.
 */

function startEvent(type: string, sessionId: string): IncomingEvent {
  return { type, timestamp: '2026-07-09T00:00:00Z', payload: { sessionId } };
}

/**
 * An event carrying a `workdir` (as the codex/claude hook bridges POST).
 * LocalCortex's own fulfillment runs set workdir under the run-staging root.
 */
function eventWithWorkdir(type: string, sessionId: string, workdir: string): IncomingEvent {
  return { type, timestamp: '2026-07-09T00:00:00Z', payload: { sessionId, workdir } };
}

function eventRule(id: string, eventType: string): Rule {
  return {
    id,
    name: id,
    enabled: true,
    rule: 'r',
    trigger: { type: 'event', eventType },
    mcpServers: ['demo'],
    backend: 'claude',
    sandbox: 'read-only',
  };
}

describe('ingress onEvent observer', () => {
  it('fires onEvent for every accepted event, even with zero rule matches', async () => {
    const seen: IncomingEvent[] = [];
    const app = buildIngress({
      getRules: () => [],
      onMatched: async () => {},
      onEvent: (e) => {
        seen.push(e);
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/event',
      payload: startEvent('codex.prompt-submit', 'sess_1'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, matched: 0 });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.type).toBe('codex.prompt-submit');
    await app.close();
  });

  it('fires onEvent before onMatched and regardless of matches', async () => {
    const order: string[] = [];
    const app = buildIngress({
      getRules: () => [eventRule('r1', 'codex.session-complete')],
      onMatched: async () => {
        order.push('matched');
      },
      onEvent: () => {
        order.push('event');
      },
    });
    // A prompt-submit event that matches NO rule — onEvent should still fire.
    await app.inject({
      method: 'POST',
      url: '/event',
      payload: startEvent('codex.prompt-submit', 'sess_2'),
    });
    expect(order).toEqual(['event']);
    await app.close();

    // A session-complete event that DOES match — onEvent fires, then onMatched.
    const order2: string[] = [];
    const app2 = buildIngress({
      getRules: () => [eventRule('r1', 'codex.session-complete')],
      onMatched: async () => {
        order2.push('matched');
      },
      onEvent: () => {
        order2.push('event');
      },
    });
    await app2.inject({
      method: 'POST',
      url: '/event',
      payload: startEvent('codex.session-complete', 'sess_3'),
    });
    expect(order2).toEqual(['event', 'matched']);
    await app2.close();
  });

  it('a throwing onEvent observer does not break the match/enqueue path or the reply', async () => {
    const matched: string[] = [];
    const app = buildIngress({
      getRules: () => [eventRule('r1', 'codex.session-complete')],
      onMatched: async (_e, rules) => {
        matched.push(...rules.map((r) => r.id));
      },
      onEvent: () => {
        throw new Error('observer blew up');
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/event',
      payload: startEvent('codex.session-complete', 'sess_4'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, matched: 1 });
    expect(matched).toEqual(['r1']);
    await app.close();
  });

  it('does not fire onEvent when the event is malformed (400 short-circuits)', async () => {
    const seen: IncomingEvent[] = [];
    const app = buildIngress({
      getRules: () => [],
      onMatched: async () => {},
      onEvent: (e) => {
        seen.push(e);
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/event',
      payload: { timestamp: '2026-07-09T00:00:00Z' }, // missing type
    });
    expect(res.statusCode).toBe(400);
    expect(seen).toHaveLength(0);
    await app.close();
  });

  // Regression guard: a prompt-submit event that matches a rule runs BOTH the
  // onEvent observer (popup) AND the onMatched path (rule run). The matcher is
  // generic — prompt-submit is NOT a popup-only event type — and this locks
  // that in so a future carve-out doesn't silently pass.
  it('a prompt-submit event matching a rule fires onEvent AND onMatched (both)', async () => {
    const seen: string[] = [];
    const matchedEvents: IncomingEvent[] = [];
    const app = buildIngress({
      getRules: () => [eventRule('r_start', 'zcode.prompt-submit')],
      onMatched: async (e, rules) => {
        seen.push('matched');
        matchedEvents.push(e);
        expect(rules.map((r) => r.id)).toEqual(['r_start']);
      },
      onEvent: (e) => {
        seen.push('event');
        expect(e.type).toBe('zcode.prompt-submit');
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/event',
      payload: startEvent('zcode.prompt-submit', 'sess_both'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, matched: 1 });
    expect(seen).toEqual(['event', 'matched']);
    // onMatched received the original event (enrichment happens inside index.ts
    // wiring, not in the ingress itself; the ingress hands onMatched the event).
    expect(matchedEvents[0]!.payload['sessionId']).toBe('sess_both');
    await app.close();
  });
});

describe('ingress self-event filtering', () => {
  // Regression guard for the feedback loop: LocalCortex's own Codex/Claude
  // fulfillment runs fire the hook plugin (installed in the backend), which
  // POSTs session-complete events back to the ingress. Those carry a workdir
  // under the run-staging root and would re-trigger the handoff rule → loop.
  // The ingress drops them before matching/observers when
  // selfEventWorkdirPrefix is set.

  const SELF_PREFIX = '/home/user/.localcortex/runs/work';

  it('drops an event whose workdir is under the self-event prefix', async () => {
    const matched: string[] = [];
    const observed: IncomingEvent[] = [];
    const app = buildIngress({
      selfEventWorkdirPrefix: SELF_PREFIX,
      getRules: () => [eventRule('r1', 'codex.session-complete')],
      onMatched: async (_e, rules) => {
        matched.push(...rules.map((r) => r.id));
      },
      onEvent: (e) => {
        observed.push(e);
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/event',
      payload: eventWithWorkdir(
        'codex.session-complete',
        'sess_self',
        `${SELF_PREFIX}/handoff-auto`,
      ),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, matched: 0, selfEvent: true });
    // Neither the matcher nor the observer fired.
    expect(matched).toHaveLength(0);
    expect(observed).toHaveLength(0);
    await app.close();
  });

  it('still processes a real session event whose workdir is NOT under the prefix', async () => {
    const matched: string[] = [];
    const observed: IncomingEvent[] = [];
    const app = buildIngress({
      selfEventWorkdirPrefix: SELF_PREFIX,
      getRules: () => [eventRule('r1', 'codex.session-complete')],
      onMatched: async (_e, rules) => {
        matched.push(...rules.map((r) => r.id));
      },
      onEvent: (e) => {
        observed.push(e);
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/event',
      payload: eventWithWorkdir(
        'codex.session-complete',
        'sess_real',
        '/Users/me/projects/myrepo',
      ),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, matched: 1 });
    expect(matched).toEqual(['r1']);
    expect(observed).toHaveLength(1);
    await app.close();
  });

  it('does not filter when selfEventWorkdirPrefix is unset (back-compat)', async () => {
    const matched: string[] = [];
    const app = buildIngress({
      // no selfEventWorkdirPrefix
      getRules: () => [eventRule('r1', 'codex.session-complete')],
      onMatched: async (_e, rules) => {
        matched.push(...rules.map((r) => r.id));
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/event',
      payload: eventWithWorkdir(
        'codex.session-complete',
        'sess_self',
        `${SELF_PREFIX}/handoff-auto`,
      ),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, matched: 1 });
    expect(matched).toEqual(['r1']);
    await app.close();
  });

  it('ignores a non-string workdir (does not throw, processes normally)', async () => {
    const matched: string[] = [];
    const app = buildIngress({
      selfEventWorkdirPrefix: SELF_PREFIX,
      getRules: () => [eventRule('r1', 'codex.session-complete')],
      onMatched: async (_e, rules) => {
        matched.push(...rules.map((r) => r.id));
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/event',
      payload: {
        type: 'codex.session-complete',
        timestamp: '2026-07-09T00:00:00Z',
        payload: { sessionId: 'sess_x', workdir: 12345 }, // non-string
      },
    });
    expect(res.statusCode).toBe(200);
    expect(matched).toEqual(['r1']);
    await app.close();
  });
});
