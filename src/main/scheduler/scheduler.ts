/**
 * Per-rule timer scheduler for tick-triggered rules.
 *
 * Spec: docs/architecture.md §3.4, §6.5, rule-config-schema.md §3.1.
 *
 *  - Owns one timer per ENABLED, TICK-triggered rule. Event-triggered rules
 *    are ignored here (they fire via the ingress/matcher path).
 *  - Effective interval = rule.trigger.intervalSeconds ?? globalDefault, clamped
 *    to the 5-minute floor (rule-config-schema §11.2).
 *  - On each tick, enqueues a run via the provided callback (the run-loop owns
 *    the capped-parallelism queue).
 *
 * Timers are injected (`TimerImpl`) so unit tests use fake timers without
 * touching the real event loop. The default impl uses `setTimeout`/`clearTimeout`.
 *
 * Pure logic — no `electron` import.
 */

import type { Rule } from '@shared/types';
import { DEFAULT_TICK_INTERVAL_SECONDS, MIN_TICK_INTERVAL_SECONDS } from '@shared/constants';

/** Abstraction over a single delayed callback, so tests can fakes timers. */
export interface ScheduledHandle {
  clear(): void;
}

export interface TimerImpl {
  schedule(delayMs: number, fn: () => void): ScheduledHandle;
}

/** Default timer using Node's setTimeout (self-rescheduling via re-schedule). */
export class NodeTimer implements TimerImpl {
  schedule(delayMs: number, fn: () => void): ScheduledHandle {
    const id = setTimeout(fn, delayMs);
    // Don't keep the event loop alive solely for a scheduled tick.
    if (typeof id === 'object' && id && 'unref' in id) id.unref?.();
    return {
      clear() {
        clearTimeout(id);
      },
    };
  }
}

/** Optional global default tick interval (from app settings). */
export interface EffectiveIntervalArgs {
  globalDefaultSeconds?: number;
}

/**
 * Compute the effective tick interval (in seconds) for a rule.
 *  - rule override wins; else global default; else the built-in default.
 *  - always clamped to >= MIN_TICK_INTERVAL_SECONDS.
 *
 * Throws if `rule` is not tick-triggered (the scheduler only handles ticks).
 */
export function effectiveIntervalSeconds(
  rule: Pick<Rule, 'trigger'>,
  args: EffectiveIntervalArgs = {},
): number {
  const { trigger } = rule;
  if (trigger.type !== 'tick') {
    throw new Error(`effectiveIntervalSeconds: rule is not tick-triggered (got ${trigger.type})`);
  }
  const base =
    trigger.intervalSeconds ?? args.globalDefaultSeconds ?? DEFAULT_TICK_INTERVAL_SECONDS;
  return Math.max(base, MIN_TICK_INTERVAL_SECONDS);
}

/** A rule id → handle map held by the Scheduler. */
interface ScheduledRule {
  handle: ScheduledHandle;
}

export interface SchedulerCallbacks {
  /** Called on every tick for a rule (enqueue a run). */
  onTick: (ruleId: string) => void;
  /** Timer implementation (defaults to NodeTimer). */
  timer?: TimerImpl;
}

/**
 * Schedules enabled tick-triggered rules. Re-scheduled after each tick
 * (one-shot setTimeout per cycle), so a long-running tick callback never
 * overlaps with the next.
 */
export class Scheduler {
  private readonly onTick: (ruleId: string) => void;
  private readonly timer: TimerImpl;
  private readonly scheduled = new Map<string, ScheduledRule>();

  constructor(callbacks: SchedulerCallbacks) {
    this.onTick = callbacks.onTick;
    this.timer = callbacks.timer ?? new NodeTimer();
  }

  /** Currently-scheduled rule ids. */
  get scheduledRuleIds(): string[] {
    return [...this.scheduled.keys()];
  }

  /**
   * Schedule or reschedule a single rule. No-op for disabled or non-tick rules.
   */
  schedule(rule: Pick<Rule, 'id' | 'enabled' | 'trigger'>, globalDefaultSeconds?: number): void {
    this.unschedule(rule.id);
    if (!rule.enabled) return;
    if (rule.trigger.type !== 'tick') return;

    const intervalMs = effectiveIntervalSeconds(rule, { globalDefaultSeconds }) * 1000;
    const tick = () => {
      // Re-schedule before invoking, so the next tick is queued regardless of
      // the callback's outcome/duration.
      this.scheduleNext(rule.id, intervalMs, tick);
      try {
        this.onTick(rule.id);
      } catch (e) {
        // Swallow callback errors so the scheduler keeps ticking. Logging is the
        // caller's responsibility.
        void e;
      }
    };
    this.scheduleNext(rule.id, intervalMs, tick);
  }

  private scheduleNext(ruleId: string, intervalMs: number, tick: () => void): void {
    const handle = this.timer.schedule(intervalMs, tick);
    this.scheduled.set(ruleId, { handle });
  }

  /** Stop scheduling a rule (e.g. it was disabled or deleted). */
  unschedule(ruleId: string): void {
    const entry = this.scheduled.get(ruleId);
    if (entry) {
      entry.handle.clear();
      this.scheduled.delete(ruleId);
    }
  }

  /** Bulk (re)schedule from the current set of rules. */
  rescheduleAll(
    rules: Array<Pick<Rule, 'id' | 'enabled' | 'trigger'>>,
    globalDefaultSeconds?: number,
  ): void {
    this.clear();
    for (const rule of rules) this.schedule(rule, globalDefaultSeconds);
  }

  /** Stop and clear all scheduled rules. */
  clear(): void {
    for (const { handle } of this.scheduled.values()) handle.clear();
    this.scheduled.clear();
  }
}
