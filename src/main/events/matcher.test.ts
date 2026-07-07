import { describe, it, expect } from 'vitest';
import { matchEventsToRules, globMatch } from './matcher.js';
import type { Rule, IncomingEvent } from '@shared/types';

function ev(type: string, payload: Record<string, unknown> = {}): IncomingEvent {
  return { type, timestamp: '2026-07-07T00:00:00Z', payload };
}

function eventRule(id: string, eventType: string, filter?: Record<string, string>): Rule {
  return {
    id,
    name: id,
    enabled: true,
    rule: 'r',
    trigger: { type: 'event', eventType, ...(filter ? { filter } : {}) },
    mcpServers: ['omnifocus'],
    backend: 'claude',
    sandbox: 'read-only',
  };
}

function tickRule(id: string): Rule {
  return {
    id,
    name: id,
    enabled: true,
    rule: 'r',
    trigger: { type: 'tick' },
    mcpServers: ['gitlab'],
    backend: 'claude',
    sandbox: 'read-only',
  };
}

describe('globMatch', () => {
  it('matches exact strings', () => {
    expect(globMatch('/a/b', '/a/b')).toBe(true);
  });
  it('matches * wildcard', () => {
    expect(globMatch('/Users/colin/code/*', '/Users/colin/code/web-app')).toBe(true);
    expect(globMatch('/Users/colin/code/*', '/Users/other/code/x')).toBe(false);
  });
  it('matches ? wildcard as single char', () => {
    expect(globMatch('a?c', 'abc')).toBe(true);
    expect(globMatch('a?c', 'ac')).toBe(false);
  });
});

describe('matchEventsToRules', () => {
  it('matches an event to a rule by eventType', () => {
    const rules = [eventRule('r1', 'codex.session-complete')];
    expect(matchEventsToRules(ev('codex.session-complete'), rules)).toHaveLength(1);
  });

  it('does not match when eventType differs', () => {
    const rules = [eventRule('r1', 'codex.session-complete')];
    expect(matchEventsToRules(ev('other.event'), rules)).toHaveLength(0);
  });

  it('never returns tick-triggered rules', () => {
    const rules = [tickRule('t1')];
    expect(matchEventsToRules(ev('codex.session-complete'), rules)).toHaveLength(0);
  });

  it('applies a glob filter on a payload field', () => {
    const rules = [eventRule('r1', 'codex.session-complete', { workdir: '/Users/colin/code/*' })];
    expect(
      matchEventsToRules(ev('codex.session-complete', { workdir: '/Users/colin/code/x' }), rules),
    ).toHaveLength(1);
    expect(
      matchEventsToRules(ev('codex.session-complete', { workdir: '/elsewhere' }), rules),
    ).toHaveLength(0);
  });

  it('requires ALL filter entries to match', () => {
    const rules = [eventRule('r1', 'e', { workdir: '/x/*', source: 'codex' })];
    expect(matchEventsToRules(ev('e', { workdir: '/x/y', source: 'codex' }), rules)).toHaveLength(
      1,
    );
    expect(matchEventsToRules(ev('e', { workdir: '/x/y', source: 'other' }), rules)).toHaveLength(
      0,
    );
  });

  it('does not match when a filtered field is missing', () => {
    const rules = [eventRule('r1', 'e', { workdir: '/x/*' })];
    expect(matchEventsToRules(ev('e', {}), rules)).toHaveLength(0);
  });

  it('does not match object/array payload values against a string glob', () => {
    const rules = [eventRule('r1', 'e', { workdir: '/x/*' })];
    expect(matchEventsToRules(ev('e', { workdir: { nested: true } }), rules)).toHaveLength(0);
  });

  it('returns multiple rules when several match one event', () => {
    const rules = [
      eventRule('r1', 'e'),
      eventRule('r2', 'e', { source: 'codex' }),
      eventRule('r3', 'other'),
    ];
    expect(matchEventsToRules(ev('e', { source: 'codex' }), rules).map((r) => r.id)).toEqual([
      'r1',
      'r2',
    ]);
  });
});
