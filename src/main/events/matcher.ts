/**
 * Routes an incoming event to the rules that should fire on it.
 *
 * Spec: docs/features/triggers/README.md (event trigger), docs/architecture.md §6.7.
 *
 * A rule matches an event when:
 *  - the rule's trigger is an EVENT trigger;
 *  - `trigger.eventType` equals the event's `type` exactly; AND
 *  - every entry in the optional `trigger.filter` glob-matches the same-named
 *    field in the event payload (v1: simple glob on string fields).
 *
 * Multiple rules can match one event; each produces an independent agent run.
 * Tick-triggered rules never match events.
 *
 * Pure logic — no `electron` import, unit-testable in plain Vitest.
 */

import type { Rule, IncomingEvent } from '@shared/types';

/** Minimal glob matcher: supports `*` (any run of chars) and `?` (one char). */
function globToRegExp(pattern: string): RegExp {
  // Escape regex specials, then convert glob `*`/`?` back to regex.
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${body}$`);
}

/** True if `value` (a string) matches `pattern` using simple globbing. */
export function globMatch(pattern: string, value: string): boolean {
  return globToRegExp(pattern).test(value);
}

/**
 * Stringify an event-payload value for glob matching.
 * Non-strings (numbers/booleans) are stringified; objects/arrays/null/undefined
 * never match a string glob.
 */
function asString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/**
 * Return the subset of `rules` that match the given `event`.
 */
export function matchEventsToRules(event: IncomingEvent, rules: Rule[]): Rule[] {
  return rules.filter((rule) => {
    const { trigger } = rule;
    if (trigger.type !== 'event') return false; // tick rules don't react to events
    if (trigger.eventType !== event.type) return false;

    const filter = trigger.filter;
    if (!filter) return true;

    // Every filter entry must glob-match its payload field.
    for (const [field, pattern] of Object.entries(filter)) {
      const raw = event.payload[field];
      const s = asString(raw);
      if (s === null) return false;
      if (!globMatch(pattern, s)) return false;
    }
    return true;
  });
}
