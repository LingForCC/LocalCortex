import { describe, it, expect, beforeEach } from 'vitest';
import { openMemoryDatabase } from '../client.js';
import { runMigrations } from '../migrate.js';
import { HandoffsRepository } from './handoffs.js';
import type { DatabaseSync } from 'node:sqlite';
import type { Handoff } from '@shared/types';

let db: DatabaseSync;
let repo: HandoffsRepository;

beforeEach(() => {
  db = openMemoryDatabase();
  runMigrations(db);
  repo = new HandoffsRepository(db);
});

function makeHandover(overrides: Partial<Handoff> = {}): Handoff {
  return {
    id: 'h1',
    sessionId: 'sess_abc',
    context: { parentTaskId: 'o2LOz5FWVIj', taskManager: 'omnifocus' },
    reminderTitle: undefined,
    enabled: true,
    createdAt: '2026-07-08T00:00:00Z',
    updatedAt: '2026-07-08T00:00:00Z',
    ...overrides,
  };
}

describe('HandoffsRepository', () => {
  it('creates and retrieves a handoff, round-tripping context through JSON', () => {
    repo.create(makeHandover());
    const got = repo.get('h1');
    expect(got).not.toBeNull();
    expect(got!.sessionId).toBe('sess_abc');
    expect(got!.context).toEqual({ parentTaskId: 'o2LOz5FWVIj', taskManager: 'omnifocus' });
    expect(got!.enabled).toBe(true);
  });

  it('lists handoffs newest-first', () => {
    repo.create(makeHandover({ id: 'old', createdAt: '2026-07-07T00:00:00Z' }));
    repo.create(makeHandover({ id: 'new', createdAt: '2026-07-08T12:00:00Z' }));
    const list = repo.list();
    expect(list.map((h) => h.id)).toEqual(['new', 'old']);
  });

  it('findEnabledBySessionId returns only enabled handoffs', () => {
    repo.create(makeHandover({ id: 'h1', sessionId: 'sess_x', enabled: true }));
    repo.create(makeHandover({ id: 'h2', sessionId: 'sess_y', enabled: false }));
    expect(repo.findEnabledBySessionId('sess_x')?.id).toBe('h1');
    expect(repo.findEnabledBySessionId('sess_y')).toBeNull();
    expect(repo.findEnabledBySessionId('sess_unknown')).toBeNull();
  });

  it('findEnabledBySessionId returns the most recent when several exist', () => {
    repo.create(
      makeHandover({ id: 'old', sessionId: 'sess_x', createdAt: '2026-07-01T00:00:00Z' }),
    );
    repo.create(
      makeHandover({ id: 'new', sessionId: 'sess_x', createdAt: '2026-07-09T00:00:00Z' }),
    );
    expect(repo.findEnabledBySessionId('sess_x')?.id).toBe('new');
  });

  it('setEnabled flips the flag and persists', () => {
    repo.create(makeHandover({ id: 'h1', enabled: true }));
    expect(repo.setEnabled('h1', false)).toBe(true);
    expect(repo.get('h1')?.enabled).toBe(false);
    // A disabled handoff no longer matches findEnabled.
    expect(repo.findEnabledBySessionId('sess_abc')).toBeNull();
    // Re-enabling makes it match again.
    repo.setEnabled('h1', true);
    expect(repo.findEnabledBySessionId('sess_abc')?.id).toBe('h1');
  });

  it('setEnabled on a missing id returns false', () => {
    expect(repo.setEnabled('nope', true)).toBe(false);
  });

  it('delete removes a handoff', () => {
    repo.create(makeHandover({ id: 'h1' }));
    expect(repo.delete('h1')).toBe(true);
    expect(repo.get('h1')).toBeNull();
    expect(repo.delete('h1')).toBe(false);
  });

  it('normalizes a non-0/1 enabled integer to false (defensive read)', () => {
    // Insert a row with enabled=7 directly via SQL (bypasses repo validation).
    // rowToHandoff does `enabled === 1`, so any non-1 value becomes false.
    db.prepare(
      `INSERT INTO pending_reviews (id, session_id, context_json, enabled) VALUES (?, ?, ?, ?)`,
    ).run('bad', 's', '{}', 7);
    const got = repo.get('bad');
    expect(got).not.toBeNull();
    expect(got!.enabled).toBe(false);
  });

  it('throws on read when context_json is invalid (schema parse fails)', () => {
    db.prepare(
      `INSERT INTO pending_reviews (id, session_id, context_json, enabled) VALUES (?, ?, ?, ?)`,
    ).run('bad', 's', '{not json', 1);
    expect(() => repo.get('bad')).toThrow();
  });
});
