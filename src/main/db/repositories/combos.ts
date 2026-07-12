/**
 * Repository for the `handoff_combos` table.
 *
 * Spec: docs/features/handoff-setup/README.md, docs/tech-stack.md §4 (raw SQL
 * + Zod row validation). Mirrors the `handoffs` / `rules` repository pattern:
 * every query is raw SQL, every returned row is parsed through `ComboSchema`.
 *
 * Constructed with a `DatabaseSync` instance — tests pass an in-memory DB; the
 * main process passes the real file-backed one. Does NOT import `electron`.
 *
 * NOTE: this repo is a thin data-access layer. It does NOT keep the owned rule
 * in sync — that orchestration (create/update rule alongside the combo, mirror
 * enabled, broadcast rules:changed) lives in the IPC layer
 * (`src/main/ipc/combos.ts`).
 */

import type { DatabaseSync } from 'node:sqlite';
import { ComboSchema } from '@shared/schemas/combo-schema';
import type { Combo } from '@shared/types';

/** Row shape as it comes out of SQLite (snake_case, before normalization). */
interface ComboRow {
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

/** Convert a raw DB row into a validated Combo. */
export function rowToCombo(row: ComboRow): Combo {
  return ComboSchema.parse({
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

export class CombosRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** All combos, newest first. */
  list(): Combo[] {
    const rows = this.db
      .prepare(
        `SELECT id, label, agent_id, task_manager_id, backend, rule_id,
                enabled, created_at, updated_at
         FROM handoff_combos ORDER BY created_at DESC`,
      )
      .all() as unknown as ComboRow[];
    return rows.map(rowToCombo);
  }

  /** One combo by id, or null. */
  get(id: string): Combo | null {
    const row = this.db
      .prepare(
        `SELECT id, label, agent_id, task_manager_id, backend, rule_id,
                enabled, created_at, updated_at
         FROM handoff_combos WHERE id = ?`,
      )
      .get(id) as ComboRow | undefined;
    return row ? rowToCombo(row) : null;
  }

  /** Insert a new combo (validated). Throws on PK conflict or FK violation. */
  create(combo: Combo): void {
    const parsed = ComboSchema.parse(combo);
    this.db
      .prepare(
        `INSERT INTO handoff_combos (id, label, agent_id, task_manager_id,
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
   * Update the user-editable fields of a combo. Does NOT touch `enabled`
   * (use `setEnabled`) or timestamps beyond `updated_at`. Returns true if a row
   * was updated.
   */
  update(id: string, patch: { label: string; agentId: string; taskManagerId: string; backend: 'claude' | 'codex' }): boolean {
    const res = this.db
      .prepare(
        `UPDATE handoff_combos
         SET label = ?, agent_id = ?, task_manager_id = ?, backend = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(patch.label, patch.agentId, patch.taskManagerId, patch.backend, id);
    return res.changes > 0;
  }

  /**
   * Enable or disable a combo. Returns true if a row was updated. The IPC
   * layer mirrors this onto the owned rule's `enabled` so the scheduler honors
   * it (rules drive firing, not combos).
   */
  setEnabled(id: string, enabled: boolean): boolean {
    const res = this.db
      .prepare(
        `UPDATE handoff_combos SET enabled = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(enabled ? 1 : 0, id);
    return res.changes > 0;
  }

  /** Delete a combo by id. The owned rule is removed by the FK ON DELETE CASCADE. */
  delete(id: string): boolean {
    const res = this.db.prepare(`DELETE FROM handoff_combos WHERE id = ?`).run(id);
    return res.changes > 0;
  }
}
