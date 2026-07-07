import { describe, it, expect } from 'vitest';
import {
  effectiveIntervalSeconds,
  Scheduler,
  type TimerImpl,
  type ScheduledHandle,
} from './scheduler.js';
import { DEFAULT_TICK_INTERVAL_SECONDS, MIN_TICK_INTERVAL_SECONDS } from '@shared/constants.js';
import type { Rule } from '@shared/types';

// --- Pure cadence math -----------------------------------------------------

describe('effectiveIntervalSeconds', () => {
  const tick = (intervalSeconds?: number): Pick<Rule, 'trigger'> => ({
    trigger: intervalSeconds ? { type: 'tick', intervalSeconds } : { type: 'tick' },
  });

  it('uses the rule override', () => {
    expect(effectiveIntervalSeconds(tick(600))).toBe(600);
  });

  it('falls back to the global default when omitted', () => {
    expect(effectiveIntervalSeconds(tick(), { globalDefaultSeconds: 1200 })).toBe(1200);
  });

  it('falls back to the built-in default when no override and no global', () => {
    expect(effectiveIntervalSeconds(tick())).toBe(DEFAULT_TICK_INTERVAL_SECONDS);
  });

  it('clamps below the 5-min floor', () => {
    expect(effectiveIntervalSeconds(tick(60))).toBe(MIN_TICK_INTERVAL_SECONDS);
  });

  it('clamps the global default below the floor too', () => {
    expect(effectiveIntervalSeconds(tick(), { globalDefaultSeconds: 10 })).toBe(
      MIN_TICK_INTERVAL_SECONDS,
    );
  });

  it('throws for a non-tick rule', () => {
    const eventRule: Pick<Rule, 'trigger'> = {
      trigger: { type: 'event', eventType: 'codex.session-complete' },
    };
    expect(() => effectiveIntervalSeconds(eventRule)).toThrow(/not tick-triggered/);
  });
});

// --- Scheduler with a fake timer -------------------------------------------

/** A deterministic fake timer that fires only when `tick()` is called. */
class FakeTimer implements TimerImpl {
  fires = 0;
  schedule(_delayMs: number, fn: () => void): ScheduledHandle {
    this.fn = fn;
    return {
      clear: () => {
        this.fn = undefined;
      },
    };
  }
  private fn?: () => void;
  tick() {
    this.fires++;
    this.fn?.();
  }
  get armed() {
    return this.fn !== undefined;
  }
}

describe('Scheduler', () => {
  const tickRule = (id: string, enabled = true, intervalSeconds?: number): Rule => ({
    id,
    name: id,
    enabled,
    rule: 'r',
    trigger: intervalSeconds ? { type: 'tick', intervalSeconds } : { type: 'tick' },
    mcpServers: ['s'],
    backend: 'claude',
    sandbox: 'read-only',
  });

  const eventRule = (id: string): Rule => ({
    id,
    name: id,
    enabled: true,
    rule: 'r',
    trigger: { type: 'event', eventType: 'x' },
    mcpServers: ['s'],
    backend: 'claude',
    sandbox: 'read-only',
  });

  it('schedules enabled tick rules and fires onTick', () => {
    const timer = new FakeTimer();
    const fired: string[] = [];
    const s = new Scheduler({ onTick: (id) => fired.push(id), timer });
    s.schedule(tickRule('r1'));
    expect(s.scheduledRuleIds).toEqual(['r1']);
    expect(timer.armed).toBe(true);

    timer.tick();
    expect(fired).toEqual(['r1']);
    // Re-armed for the next cycle.
    expect(timer.armed).toBe(true);
  });

  it('does not schedule disabled rules', () => {
    const timer = new FakeTimer();
    const s = new Scheduler({ onTick: () => {}, timer });
    s.schedule(tickRule('r1', false));
    expect(s.scheduledRuleIds).toEqual([]);
    expect(timer.armed).toBe(false);
  });

  it('does not schedule event-triggered rules', () => {
    const timer = new FakeTimer();
    const s = new Scheduler({ onTick: () => {}, timer });
    s.schedule(eventRule('r1'));
    expect(s.scheduledRuleIds).toEqual([]);
  });

  it('unschedule clears the rule', () => {
    const timer = new FakeTimer();
    const s = new Scheduler({ onTick: () => {}, timer });
    s.schedule(tickRule('r1'));
    s.unschedule('r1');
    expect(s.scheduledRuleIds).toEqual([]);
    expect(timer.armed).toBe(false);
  });

  it('rescheduleAll replaces the current set', () => {
    const timer = new FakeTimer();
    const s = new Scheduler({ onTick: () => {}, timer });
    s.schedule(tickRule('r1'));
    s.rescheduleAll([tickRule('r2'), eventRule('r3')]);
    expect(s.scheduledRuleIds).toEqual(['r2']);
  });

  it('swallows onTick errors so the next tick still fires', () => {
    const timer = new FakeTimer();
    let calls = 0;
    const s = new Scheduler({
      onTick: () => {
        calls++;
        throw new Error('boom');
      },
      timer,
    });
    s.schedule(tickRule('r1'));
    timer.tick();
    timer.tick();
    expect(calls).toBe(2);
    expect(timer.armed).toBe(true);
  });
});
