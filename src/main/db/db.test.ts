import { describe, it, expect, beforeEach } from 'vitest';
import { openMemoryDatabase } from './client.js';
import { runMigrations, currentVersion } from './migrate.js';
import { RulesRepository } from './repositories/rules.js';
import { RunsRepository } from './repositories/runs.js';
import { SettingsRepository } from './repositories/settings.js';
import type { DatabaseSync } from 'node:sqlite';
import { DEFAULT_TICK_INTERVAL_SECONDS, DEFAULT_CONCURRENCY } from '@shared/constants.js';
import type { Rule } from '@shared/types';

let db: DatabaseSync;
beforeEach(() => {
  db = openMemoryDatabase();
});

describe('runMigrations', () => {
  it('applies 001_initial and records the version', () => {
    const res = runMigrations(db);
    expect(res.applied).toContain(1);
    expect(currentVersion(db)).toBeGreaterThanOrEqual(1);

    // Core tables exist.
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as {
      name: string;
    }[];
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['rules', 'runs', 'app_settings', 'schema_version']),
    );
  });

  it('is idempotent on a second call', () => {
    runMigrations(db);
    const second = runMigrations(db);
    expect(second.applied).toEqual([]);
  });
});

describe('RulesRepository', () => {
  beforeEach(() => runMigrations(db));

  const tickRule: Rule = {
    id: 'r1',
    name: 'Tick rule',
    enabled: true,
    rule: 'Do something.',
    trigger: { type: 'tick', intervalSeconds: 600 },
    mcpServers: ['gitlab'],
    backend: 'claude',
    workdir: '/code',
    sandbox: 'read-only',
    maxRuns: 5,
  };

  it('creates and retrieves a rule, preserving JSON fields', () => {
    const repo = new RulesRepository(db);
    repo.create(tickRule);
    const got = repo.get('r1');
    expect(got?.name).toBe('Tick rule');
    expect(got?.trigger).toEqual({ type: 'tick', intervalSeconds: 600 });
    expect(got?.mcpServers).toEqual(['gitlab']);
    expect(got?.runCount).toBe(0);
  });

  it('lists rules ordered by name', () => {
    const repo = new RulesRepository(db);
    repo.create({ ...tickRule, id: 'b', name: 'Banana' });
    repo.create({ ...tickRule, id: 'a', name: 'Apple' });
    const names = repo.list().map((r) => r.name);
    expect(names).toEqual(['Apple', 'Banana']);
  });

  it('updates a rule and persists changed fields', () => {
    const repo = new RulesRepository(db);
    repo.create(tickRule);
    repo.update({ ...tickRule, name: 'Renamed', enabled: false });
    const got = repo.get('r1');
    expect(got?.name).toBe('Renamed');
    expect(got?.enabled).toBe(false);
  });

  it('set enabled records a disable reason and clears it on re-enable', () => {
    const repo = new RulesRepository(db);
    repo.create(tickRule);
    repo.setEnabled('r1', false, 'max runs reached');
    expect(repo.get('r1')?.disableReason).toBe('max runs reached');
    repo.setEnabled('r1', true);
    expect(repo.get('r1')?.disableReason).toBeUndefined();
  });

  it('increments and resets run count', () => {
    const repo = new RulesRepository(db);
    repo.create(tickRule);
    expect(repo.incrementRunCount('r1')).toBe(1);
    expect(repo.incrementRunCount('r1')).toBe(2);
    repo.resetRunCount('r1');
    expect(repo.get('r1')?.runCount).toBe(0);
  });

  it('deletes a rule', () => {
    const repo = new RulesRepository(db);
    repo.create(tickRule);
    expect(repo.delete('r1')).toBe(true);
    expect(repo.get('r1')).toBeNull();
  });

  it('rejects an invalid rule via the schema on create', () => {
    const repo = new RulesRepository(db);
    // @ts-expect-error intentionally invalid trigger
    expect(() => repo.create({ ...tickRule, trigger: { type: 'nope' } })).toThrow();
  });
});

describe('RunsRepository', () => {
  beforeEach(() => runMigrations(db));

  it('records a run and reads it back with all fields', () => {
    const rules = new RulesRepository(db);
    const runs = new RunsRepository(db);
    rules.create({
      id: 'r1',
      name: 'R',
      enabled: true,
      rule: 'r',
      trigger: { type: 'tick' },
      mcpServers: ['s'],
      backend: 'claude',
      sandbox: 'read-only',
    });

    const id = runs.create({
      ruleId: 'r1',
      trigger: 'tick',
      startedAt: '2026-07-07T00:00:00Z',
      endedAt: '2026-07-07T00:00:05Z',
      status: 'success',
      prompt: 'do it',
      toolCalls: [{ tool: 'search', args: { q: 'x' } }],
      inputTokens: 100,
      outputTokens: 50,
      durationMs: 5000,
      result: 'done',
      parsedStatus: { status: 'done', reason: 'merged' },
    });

    const got = runs.get(id);
    expect(got?.prompt).toBe('do it');
    expect(got?.toolCalls).toHaveLength(1);
    expect(got?.parsedStatus).toEqual({ status: 'done', reason: 'merged' });
    expect(got?.inputTokens).toBe(100);
  });

  it('lists runs newest-first, optionally filtered by rule', () => {
    const rules = new RulesRepository(db);
    const runs = new RunsRepository(db);
    rules.create({
      id: 'r1',
      name: 'R',
      enabled: true,
      rule: 'r',
      trigger: { type: 'tick' },
      mcpServers: ['s'],
      backend: 'claude',
      sandbox: 'read-only',
    });
    rules.create({
      id: 'r2',
      name: 'R2',
      enabled: true,
      rule: 'r',
      trigger: { type: 'tick' },
      mcpServers: ['s'],
      backend: 'claude',
      sandbox: 'read-only',
    });

    for (const ruleId of ['r1', 'r1', 'r2']) {
      runs.create({
        ruleId,
        trigger: 'tick',
        startedAt: '2026-07-07T00:00:00Z',
        status: 'success',
        prompt: 'p',
      });
    }
    expect(runs.list(null).map((r) => r.ruleId)).toEqual(['r2', 'r1', 'r1']);
    expect(runs.list('r1').map((r) => r.ruleId)).toEqual(['r1', 'r1']);
  });

  it('cascades deletes when a rule is removed', () => {
    const rules = new RulesRepository(db);
    const runs = new RunsRepository(db);
    rules.create({
      id: 'r1',
      name: 'R',
      enabled: true,
      rule: 'r',
      trigger: { type: 'tick' },
      mcpServers: ['s'],
      backend: 'claude',
      sandbox: 'read-only',
    });
    runs.create({ ruleId: 'r1', trigger: 'tick', startedAt: 't', status: 'success', prompt: 'p' });
    rules.delete('r1');
    expect(runs.list('r1')).toEqual([]);
  });
});

describe('SettingsRepository', () => {
  beforeEach(() => runMigrations(db));

  it('returns defaults on an empty table', () => {
    const s = new SettingsRepository(db).get();
    expect(s.tickIntervalSeconds).toBe(DEFAULT_TICK_INTERVAL_SECONDS);
    expect(s.concurrency).toBe(DEFAULT_CONCURRENCY);
  });

  it('persists and merges partial updates', () => {
    const repo = new SettingsRepository(db);
    repo.update({ concurrency: 5 });
    expect(repo.get().concurrency).toBe(5);
    expect(repo.get().tickIntervalSeconds).toBe(DEFAULT_TICK_INTERVAL_SECONDS); // unchanged

    repo.update({ tickIntervalSeconds: 7200 });
    expect(repo.get().tickIntervalSeconds).toBe(7200);
    expect(repo.get().concurrency).toBe(5); // unchanged
  });

  it('stores an optional ingress secret', () => {
    const repo = new SettingsRepository(db);
    repo.update({ ingressSecret: 'shh' });
    expect(repo.get().ingressSecret).toBe('shh');
  });
});
