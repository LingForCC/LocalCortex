import { describe, it, expect, beforeEach } from 'vitest';
import { openMemoryDatabase } from '../client.js';
import { runMigrations } from '../migrate.js';
import { AgentsRepository } from './agents.js';
import type { DatabaseSync } from 'node:sqlite';
import type { AgentEntry } from '@shared/types';

let db: DatabaseSync;
beforeEach(() => {
  db = openMemoryDatabase();
  runMigrations(db);
});

const customAgent: Omit<AgentEntry, 'createdAt' | 'updatedAt'> = {
  id: 'cursor',
  label: 'Cursor',
  description: 'Cursor IDE agent',
  sessionCompleteEventType: 'cursor.session-complete',
  promptSubmitEventType: 'cursor.prompt-submit',
  source: 'cursor',
  installInstructions: 'Install the Cursor hook.',
  isBuiltin: false,
};

describe('AgentsRepository — seeding', () => {
  it('seeds zcode and codex on migration', () => {
    const repo = new AgentsRepository(db);
    const ids = repo.list().map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['zcode', 'codex']));
  });

  it('seeds agents with the correct event types', () => {
    const repo = new AgentsRepository(db);
    const zcode = repo.get('zcode');
    expect(zcode?.sessionCompleteEventType).toBe('zcode.session-complete');
    expect(zcode?.promptSubmitEventType).toBe('zcode.prompt-submit');
    expect(zcode?.source).toBe('zcode');
  });
});

describe('AgentsRepository — CRUD', () => {
  it('creates and retrieves a custom agent', () => {
    const repo = new AgentsRepository(db);
    repo.create(customAgent);
    const got = repo.get('cursor');
    expect(got?.label).toBe('Cursor');
    expect(got?.isBuiltin).toBe(false);
  });

  it('lists builtin agents first, then custom', () => {
    const repo = new AgentsRepository(db);
    repo.create(customAgent);
    const ids = repo.list().map((a) => a.id);
    // Builtins (zcode, codex) should come before the custom one.
    expect(ids.indexOf('zcode')).toBeLessThan(ids.indexOf('cursor'));
    expect(ids.indexOf('codex')).toBeLessThan(ids.indexOf('cursor'));
  });

  it('updates an agent', () => {
    const repo = new AgentsRepository(db);
    repo.create(customAgent);
    repo.update({ ...customAgent, label: 'Cursor IDE' });
    expect(repo.get('cursor')?.label).toBe('Cursor IDE');
  });

  it('deletes an agent', () => {
    const repo = new AgentsRepository(db);
    repo.create(customAgent);
    expect(repo.delete('cursor')).toBe(true);
    expect(repo.get('cursor')).toBeNull();
  });

  it('returns null for a nonexistent id', () => {
    const repo = new AgentsRepository(db);
    expect(repo.get('nonexistent')).toBeNull();
  });
});
