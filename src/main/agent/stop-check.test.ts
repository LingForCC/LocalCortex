import { describe, it, expect } from 'vitest';
import { evaluateStop, resolveMaxRuns } from './stop-check.js';
import { DEFAULT_MAX_RUNS } from '@shared/constants.js';

const NOW = new Date('2026-07-07T12:00:00Z');

describe('resolveMaxRuns', () => {
  it('uses the explicit rule value', () => {
    expect(resolveMaxRuns(10)).toBe(10);
  });
  it('returns null (unlimited) for explicit null', () => {
    expect(resolveMaxRuns(null)).toBeNull();
  });
  it('falls back to global default when undefined', () => {
    expect(resolveMaxRuns(undefined, 99)).toBe(99);
  });
  it('falls back to built-in default when no rule and no global', () => {
    expect(resolveMaxRuns(undefined)).toBe(DEFAULT_MAX_RUNS);
  });
});

describe('evaluateStop', () => {
  it('disables on agent-signaled done', () => {
    const out = evaluateStop({
      parsedStatus: { status: 'done', reason: 'merged' },
      runCount: 1,
      now: () => NOW,
    });
    expect(out).toEqual({ shouldDisable: true, reason: 'agent signaled done: merged' });
  });

  it('disables on agent-signaled error', () => {
    const out = evaluateStop({
      parsedStatus: { status: 'error', reason: 'auth failed' },
      runCount: 1,
      now: () => NOW,
    });
    expect(out.shouldDisable).toBe(true);
    expect(out.reason).toContain('agent error');
  });

  it('keeps running on active status', () => {
    expect(
      evaluateStop({ parsedStatus: { status: 'active' }, runCount: 1, now: () => NOW }),
    ).toEqual({ shouldDisable: false });
  });

  it('keeps running when no status block was parsed', () => {
    expect(evaluateStop({ parsedStatus: null, runCount: 1, now: () => NOW })).toEqual({
      shouldDisable: false,
    });
  });

  it('disables when expiresAt is in the past', () => {
    const out = evaluateStop({
      parsedStatus: { status: 'active' },
      runCount: 1,
      expiresAt: '2026-07-06T00:00:00Z',
      now: () => NOW,
    });
    expect(out.shouldDisable).toBe(true);
    expect(out.reason).toContain('expired');
  });

  it('does not disable when expiresAt is in the future', () => {
    const out = evaluateStop({
      parsedStatus: { status: 'active' },
      runCount: 1,
      expiresAt: '2026-08-01T00:00:00Z',
      now: () => NOW,
    });
    expect(out.shouldDisable).toBe(false);
  });

  it('disables when runCount reaches the rule maxRuns', () => {
    const out = evaluateStop({
      parsedStatus: { status: 'active' },
      runCount: 5,
      maxRuns: 5,
      now: () => NOW,
    });
    expect(out.shouldDisable).toBe(true);
    expect(out.reason).toContain('max runs reached (5)');
  });

  it('uses the global default when rule maxRuns is undefined', () => {
    const out = evaluateStop({
      parsedStatus: { status: 'active' },
      runCount: DEFAULT_MAX_RUNS,
      globalMaxRuns: DEFAULT_MAX_RUNS,
      now: () => NOW,
    });
    expect(out.shouldDisable).toBe(true);
  });

  it('honors explicit maxRuns:null as unlimited', () => {
    const out = evaluateStop({
      parsedStatus: { status: 'active' },
      runCount: 9999,
      maxRuns: null,
      now: () => NOW,
    });
    expect(out.shouldDisable).toBe(false);
  });

  it('agent-signaled done takes priority over maxRuns', () => {
    const out = evaluateStop({
      parsedStatus: { status: 'done' },
      runCount: 9999,
      maxRuns: 1,
      now: () => NOW,
    });
    expect(out.reason).toContain('agent signaled done');
  });
});
