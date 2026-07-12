import { describe, it, expect, beforeEach } from 'vitest';
import { openMemoryDatabase } from '../client.js';
import { runMigrations } from '../migrate.js';
import { HandoffProfilesRepository } from './handoff-profiles.js';
import type { DatabaseSync } from 'node:sqlite';
import type { HandoffProfile } from '@shared/types';

let db: DatabaseSync;
let repo: HandoffProfilesRepository;

beforeEach(() => {
  db = openMemoryDatabase();
  runMigrations(db);
  repo = new HandoffProfilesRepository(db);
});

/** Insert a minimal rule row so a profile's rule_id FK has a valid target. */
function seedRule(id: string): void {
  db.prepare(
    `INSERT INTO rules (id, name, enabled, rule, trigger_json, mcp_servers_json,
                        backend, sandbox, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    'R',
    1,
    'do thing',
    JSON.stringify({ type: 'event', eventType: 'zcode.session-complete' }),
    JSON.stringify(['omnifocus']),
    'claude',
    'read-only',
    '2026-07-08T00:00:00Z',
    '2026-07-08T00:00:00Z',
  );
}

function makeProfile(overrides: Partial<HandoffProfile> = {}): HandoffProfile {
  return {
    id: 'profile-1',
    label: 'ZCode → OmniFocus',
    agentId: 'zcode',
    taskManagerId: 'omnifocus',
    backend: 'claude',
    ruleId: 'rule-1',
    enabled: true,
    createdAt: '2026-07-08T00:00:00Z',
    updatedAt: '2026-07-08T00:00:00Z',
    ...overrides,
  };
}

describe('HandoffProfilesRepository', () => {
  it('creates and retrieves a handoff profile', () => {
    seedRule('rule-1');
    repo.create(makeProfile());
    const got = repo.get('profile-1');
    expect(got).not.toBeNull();
    expect(got!.agentId).toBe('zcode');
    expect(got!.taskManagerId).toBe('omnifocus');
    expect(got!.backend).toBe('claude');
    expect(got!.ruleId).toBe('rule-1');
    expect(got!.enabled).toBe(true);
  });

  it('lists handoff profiles newest-first', () => {
    seedRule('rule-old');
    seedRule('rule-new');
    repo.create(makeProfile({ id: 'old', ruleId: 'rule-old', createdAt: '2026-07-07T00:00:00Z' }));
    repo.create(makeProfile({ id: 'new', ruleId: 'rule-new', createdAt: '2026-07-09T00:00:00Z' }));
    expect(repo.list().map((p) => p.id)).toEqual(['new', 'old']);
  });

  it('update changes user-editable fields', () => {
    seedRule('rule-1');
    repo.create(makeProfile());
    expect(
      repo.update('profile-1', {
        label: 'Codex → OmniFocus',
        agentId: 'codex',
        taskManagerId: 'omnifocus',
        backend: 'codex',
      }),
    ).toBe(true);
    const got = repo.get('profile-1');
    expect(got!.label).toBe('Codex → OmniFocus');
    expect(got!.agentId).toBe('codex');
    expect(got!.backend).toBe('codex');
    // ruleId + enabled are untouched by update.
    expect(got!.ruleId).toBe('rule-1');
    expect(got!.enabled).toBe(true);
  });

  it('update on a missing id returns false', () => {
    expect(
      repo.update('nope', {
        label: 'x',
        agentId: 'zcode',
        taskManagerId: 'omnifocus',
        backend: 'claude',
      }),
    ).toBe(false);
  });

  it('setEnabled flips the flag and persists', () => {
    seedRule('rule-1');
    repo.create(makeProfile({ enabled: true }));
    expect(repo.setEnabled('profile-1', false)).toBe(true);
    expect(repo.get('profile-1')?.enabled).toBe(false);
    repo.setEnabled('profile-1', true);
    expect(repo.get('profile-1')?.enabled).toBe(true);
  });

  it('setEnabled on a missing id returns false', () => {
    expect(repo.setEnabled('nope', true)).toBe(false);
  });

  it('delete removes a handoff profile', () => {
    seedRule('rule-1');
    repo.create(makeProfile());
    expect(repo.delete('profile-1')).toBe(true);
    expect(repo.get('profile-1')).toBeNull();
    expect(repo.delete('profile-1')).toBe(false);
  });

  it('normalizes a non-0/1 enabled integer to false (defensive read)', () => {
    seedRule('rule-x');
    db.prepare(
      `INSERT INTO handoff_profiles (id, label, agent_id, task_manager_id, backend, rule_id, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('bad', 'l', 'zcode', 'omnifocus', 'claude', 'rule-x', 7);
    expect(repo.get('bad')?.enabled).toBe(false);
  });

  it('rejects a create with an unknown agent id (FK RESTRICT)', () => {
    seedRule('rule-1');
    expect(() =>
      repo.create(makeProfile({ agentId: 'ghost' })),
    ).toThrow();
  });

  it('rejects a create with an unknown task-manager id (FK RESTRICT)', () => {
    seedRule('rule-1');
    expect(() =>
      repo.create(makeProfile({ taskManagerId: 'ghost' })),
    ).toThrow();
  });

  it('deleting a rule cascades to delete profiles referencing it (FK CASCADE)', () => {
    // The FK profile.rule_id REFERENCES rules(id) ON DELETE CASCADE means: when
    // the parent rule row is removed, the child profile rows go too. (The IPC
    // layer is responsible for deleting the rule when a profile is deleted.)
    seedRule('rule-1');
    repo.create(makeProfile({ ruleId: 'rule-1' }));
    expect(repo.get('profile-1')).not.toBeNull();
    // Delete the parent rule directly.
    expect(db.prepare(`DELETE FROM rules WHERE id = ?`).run('rule-1').changes).toBe(1);
    // Cascade removed the profile.
    expect(repo.get('profile-1')).toBeNull();
  });
});
