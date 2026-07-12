/**
 * Repository for the `handoff_profiles` table.
 *
 * Spec: docs/features/handoff-profiles/README.md, docs/tech-stack.md §4 (raw
 * SQL + Zod row validation). Mirrors the `handoffs` / `rules` repository
 * pattern: every query is raw SQL, every returned row is parsed through
 * `HandoffProfileSchema`.
 *
 * Constructed with a `DatabaseSync` instance — tests pass an in-memory DB; the
 * main process passes the real file-backed one. Does NOT import `electron`.
 *
 * NOTE: this repo is a thin data-access layer. It does NOT keep the owned rule
 * in sync — that orchestration (create/update rule alongside the profile,
 * mirror enabled, broadcast rules:changed) lives in the IPC layer
 * (`src/main/ipc/handoff-profiles.ts`).
 */

import type { DatabaseSync } from 'node:sqlite';
import { HandoffProfileSchema } from '@shared/schemas/handoff-profile-schema';
import type { HandoffProfile } from '@shared/types';

/** Row shape as it comes out of SQLite (snake_case, before normalization). */
interface HandoffProfileRow {
  id: string;
  label: string;
  agent_id: string;
  task_manager_id: string;
  backend: string;
  rule_id: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

/** Convert a raw DB row into a validated HandoffProfile. */
export function rowToHandoffProfile(row: HandoffProfileRow): HandoffProfile {
  return HandoffProfileSchema.parse({
    id: row.id,
    label: row.label,
    agentId: row.agent_id,
    taskManagerId: row.task_manager_id,
    backend: row.backend as 'claude' | 'codex',
    ruleId: row.rule_id,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class HandoffProfilesRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** All handoff profiles, newest first. */
  list(): HandoffProfile[] {
    const rows = this.db
      .prepare(
        `SELECT id, label, agent_id, task_manager_id, backend, rule_id,
                enabled, created_at, updated_at
         FROM handoff_profiles ORDER BY created_at DESC`,
      )
      .all() as unknown as HandoffProfileRow[];
    return rows.map(rowToHandoffProfile);
  }

  /** One handoff profile by id, or null. */
  get(id: string): HandoffProfile | null {
    const row = this.db
      .prepare(
        `SELECT id, label, agent_id, task_manager_id, backend, rule_id,
                enabled, created_at, updated_at
         FROM handoff_profiles WHERE id = ?`,
      )
      .get(id) as HandoffProfileRow | undefined;
    return row ? rowToHandoffProfile(row) : null;
  }

  /** Insert a new handoff profile (validated). Throws on PK conflict or FK violation. */
  create(handoffProfile: HandoffProfile): void {
    const parsed = HandoffProfileSchema.parse(handoffProfile);
    this.db
      .prepare(
        `INSERT INTO handoff_profiles (id, label, agent_id, task_manager_id,
                                      backend, rule_id, enabled,
                                      created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.id,
        parsed.label,
        parsed.agentId,
        parsed.taskManagerId,
        parsed.backend,
        parsed.ruleId,
        parsed.enabled ? 1 : 0,
        parsed.createdAt,
        parsed.updatedAt,
      );
  }

  /**
   * Update the user-editable fields of a handoff profile. Does NOT touch
   * `enabled` (use `setEnabled`) or timestamps beyond `updated_at`. Returns
   * true if a row was updated.
   */
  update(id: string, patch: { label: string; agentId: string; taskManagerId: string; backend: 'claude' | 'codex' }): boolean {
    const res = this.db
      .prepare(
        `UPDATE handoff_profiles
         SET label = ?, agent_id = ?, task_manager_id = ?, backend = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(patch.label, patch.agentId, patch.taskManagerId, patch.backend, id);
    return res.changes > 0;
  }

  /**
   * Enable or disable a handoff profile. Returns true if a row was updated.
   * The IPC layer mirrors this onto the owned rule's `enabled` so the scheduler
   * honors it (rules drive firing, not profiles).
   */
  setEnabled(id: string, enabled: boolean): boolean {
    const res = this.db
      .prepare(
        `UPDATE handoff_profiles SET enabled = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(enabled ? 1 : 0, id);
    return res.changes > 0;
  }

  /** Delete a handoff profile by id. The owned rule is removed by the FK ON DELETE CASCADE. */
  delete(id: string): boolean {
    const res = this.db.prepare(`DELETE FROM handoff_profiles WHERE id = ?`).run(id);
    return res.changes > 0;
  }
}
