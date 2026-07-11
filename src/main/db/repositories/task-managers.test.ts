import { describe, it, expect, beforeEach } from 'vitest';
import { openMemoryDatabase } from '../client.js';
import { runMigrations } from '../migrate.js';
import { TaskManagersRepository } from './task-managers.js';
import type { DatabaseSync } from 'node:sqlite';
import type { TaskManagerEntry } from '@shared/types';

let db: DatabaseSync;
beforeEach(() => {
  db = openMemoryDatabase();
  runMigrations(db);
});

const customTM: Omit<TaskManagerEntry, 'createdAt' | 'updatedAt'> = {
  id: 'linear',
  label: 'Linear',
  description: 'Linear issue tracker',
  mcpServerName: 'github', // reuse a seeded server for the FK
  requiresToken: true,
  tokenEnvVar: 'LINEAR_API_KEY',
  setupInstructions: 'Set the LINEAR_API_KEY env var on the server.',
  isBuiltin: false,
};

describe('TaskManagersRepository — seeding', () => {
  it('seeds omnifocus on migration', () => {
    const repo = new TaskManagersRepository(db);
    const ids = repo.list().map((t) => t.id);
    expect(ids).toContain('omnifocus');
  });

  it('seeds omnifocus referencing the omnifocus mcp_servers row', () => {
    const repo = new TaskManagersRepository(db);
    const of = repo.get('omnifocus');
    expect(of?.mcpServerName).toBe('omnifocus');
    expect(of?.requiresToken).toBe(false);
    expect(of?.tokenEnvVar).toBeNull();
  });
});

describe('TaskManagersRepository — CRUD', () => {
  it('creates and retrieves a custom task manager', () => {
    const repo = new TaskManagersRepository(db);
    repo.create(customTM);
    const got = repo.get('linear');
    expect(got?.label).toBe('Linear');
    expect(got?.requiresToken).toBe(true);
    expect(got?.tokenEnvVar).toBe('LINEAR_API_KEY');
  });

  it('lists builtin task managers first', () => {
    const repo = new TaskManagersRepository(db);
    repo.create(customTM);
    const ids = repo.list().map((t) => t.id);
    expect(ids.indexOf('omnifocus')).toBeLessThan(ids.indexOf('linear'));
  });

  it('updates a task manager', () => {
    const repo = new TaskManagersRepository(db);
    repo.create(customTM);
    repo.update({ ...customTM, label: 'Linear (updated)' });
    expect(repo.get('linear')?.label).toBe('Linear (updated)');
  });

  it('deletes a task manager', () => {
    const repo = new TaskManagersRepository(db);
    repo.create(customTM);
    expect(repo.delete('linear')).toBe(true);
    expect(repo.get('linear')).toBeNull();
  });

  it('enforces the FK: cannot create a task manager referencing a missing server', () => {
    const repo = new TaskManagersRepository(db);
    expect(() =>
      repo.create({ ...customTM, id: 'bad', mcpServerName: 'nonexistent-server' }),
    ).toThrow();
  });
});
