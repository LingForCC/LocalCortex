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
    status: 'pending',
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
    expect(got!.status).toBe('pending');
  });

  it('lists handoffs newest-first', () => {
    repo.create(makeHandover({ id: 'old', createdAt: '2026-07-07T00:00:00Z' }));
    repo.create(makeHandover({ id: 'new', createdAt: '2026-07-08T12:00:00Z' }));
    const list = repo.list();
    expect(list.map((h) => h.id)).toEqual(['new', 'old']);
  });

  it('findPendingBySessionId returns only pending handoffs', () => {
    repo.create(makeHandover({ id: 'h1', sessionId: 'sess_x', status: 'pending' }));
    repo.create(makeHandover({ id: 'h2', sessionId: 'sess_y', status: 'fulfilled' }));
    expect(repo.findPendingBySessionId('sess_x')?.id).toBe('h1');
    expect(repo.findPendingBySessionId('sess_y')).toBeNull();
    expect(repo.findPendingBySessionId('sess_unknown')).toBeNull();
  });

  it('findPendingBySessionId returns the most recent when several exist', () => {
    repo.create(
      makeHandover({ id: 'old', sessionId: 'sess_x', createdAt: '2026-07-01T00:00:00Z' }),
    );
    repo.create(
      makeHandover({ id: 'new', sessionId: 'sess_x', createdAt: '2026-07-09T00:00:00Z' }),
    );
    expect(repo.findPendingBySessionId('sess_x')?.id).toBe('new');
  });

  it('markFulfilled sets status, run id, and rule id', () => {
    repo.create(makeHandover({ id: 'h1' }));
    const ok = repo.markFulfilled('h1', 42, 'rule-1');
    expect(ok).toBe(true);
    const got = repo.get('h1');
    expect(got!.status).toBe('fulfilled');
    expect(got!.fulfilledRunId).toBe(42);
    expect(got!.ruleId).toBe('rule-1');
  });

  it('markFulfilled is idempotent-safe: a fulfilled handoff no longer matches findPending', () => {
    repo.create(makeHandover({ id: 'h1', sessionId: 'sess_x' }));
    repo.markFulfilled('h1', 1);
    expect(repo.findPendingBySessionId('sess_x')).toBeNull();
  });

  it('markFulfilled without a ruleId preserves an existing ruleId', () => {
    repo.create(makeHandover({ id: 'h1', ruleId: 'pre-existing' }));
    repo.markFulfilled('h1', 5);
    expect(repo.get('h1')?.ruleId).toBe('pre-existing');
  });

  it('cancel sets status to cancelled', () => {
    repo.create(makeHandover({ id: 'h1' }));
    expect(repo.cancel('h1')).toBe(true);
    expect(repo.get('h1')?.status).toBe('cancelled');
    expect(repo.findPendingBySessionId('sess_abc')).toBeNull();
  });

  it('delete removes a handoff', () => {
    repo.create(makeHandover({ id: 'h1' }));
    expect(repo.delete('h1')).toBe(true);
    expect(repo.get('h1')).toBeNull();
    expect(repo.delete('h1')).toBe(false);
  });

  it('validates the row shape on read (rejects a bad status via parse)', () => {
    // Insert a row with an invalid status directly via SQL to bypass repo validation.
    db.prepare(
      `INSERT INTO pending_reviews (id, session_id, context_json, status) VALUES (?, ?, ?, ?)`,
    ).run('bad', 's', '{}', 'bogus');
    expect(() => repo.get('bad')).toThrow();
  });
});
