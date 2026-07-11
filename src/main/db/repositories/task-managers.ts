/**
 * Repository for the `task_managers` table — the handoff catalog's sink layer.
 *
 * Each row references an `mcp_servers` row by name (FK, ON DELETE RESTRICT) and
 * carries user-facing metadata. CRUD-able in-app. Follows the same pattern as
 * the rules repo.
 */

import type { DatabaseSync } from 'node:sqlite';
import { TaskManagerSchema } from '@shared/schemas/task-manager-schema';
import type { TaskManagerEntry } from '@shared/types';

interface TaskManagerRow {
  id: string;
  label: string;
  description: string;
  mcp_server_name: string;
  requires_token: number;
  token_env_var: string | null;
  setup_instructions: string;
  is_builtin: number;
  created_at: string;
  updated_at: string;
}

export function rowToTaskManagerEntry(row: TaskManagerRow): TaskManagerEntry {
  return TaskManagerSchema.parse({
    id: row.id,
    label: row.label,
    description: row.description,
    mcpServerName: row.mcp_server_name,
    requiresToken: row.requires_token === 1,
    tokenEnvVar: row.token_env_var,
    setupInstructions: row.setup_instructions,
    isBuiltin: row.is_builtin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class TaskManagersRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** All task managers, ordered by label. Builtin first, then custom. */
  list(): TaskManagerEntry[] {
    const rows = this.db
      .prepare(
        `SELECT id, label, description, mcp_server_name, requires_token, token_env_var,
                setup_instructions, is_builtin, created_at, updated_at
         FROM task_managers ORDER BY is_builtin DESC, label ASC`,
      )
      .all() as unknown as TaskManagerRow[];
    return rows.map(rowToTaskManagerEntry);
  }

  /** One task manager by id, or null. */
  get(id: string): TaskManagerEntry | null {
    const row = this.db
      .prepare(
        `SELECT id, label, description, mcp_server_name, requires_token, token_env_var,
                setup_instructions, is_builtin, created_at, updated_at
         FROM task_managers WHERE id = ?`,
      )
      .get(id) as TaskManagerRow | undefined;
    return row ? rowToTaskManagerEntry(row) : null;
  }

  /** Insert a new task manager. The referenced mcp_server_name must exist. */
  create(input: Omit<TaskManagerEntry, 'createdAt' | 'updatedAt'>): void {
    const parsed = TaskManagerSchema.omit({ createdAt: true, updatedAt: true }).parse(input);
    this.db
      .prepare(
        `INSERT INTO task_managers (id, label, description, mcp_server_name, requires_token,
                                    token_env_var, setup_instructions, is_builtin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.id,
        parsed.label,
        parsed.description,
        parsed.mcpServerName,
        parsed.requiresToken ? 1 : 0,
        parsed.tokenEnvVar ?? null,
        parsed.setupInstructions,
        parsed.isBuiltin ? 1 : 0,
      );
  }

  /** Update an existing task manager. No-op if the id doesn't exist. */
  update(input: Omit<TaskManagerEntry, 'createdAt' | 'updatedAt'>): boolean {
    const parsed = TaskManagerSchema.omit({ createdAt: true, updatedAt: true }).parse(input);
    const res = this.db
      .prepare(
        `UPDATE task_managers SET
            label = ?, description = ?, mcp_server_name = ?, requires_token = ?,
            token_env_var = ?, setup_instructions = ?, is_builtin = ?,
            updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        parsed.label,
        parsed.description,
        parsed.mcpServerName,
        parsed.requiresToken ? 1 : 0,
        parsed.tokenEnvVar ?? null,
        parsed.setupInstructions,
        parsed.isBuiltin ? 1 : 0,
        parsed.id,
      );
    return res.changes > 0;
  }

  /** Delete a task manager by id. Returns true if a row was removed. */
  delete(id: string): boolean {
    const res = this.db.prepare(`DELETE FROM task_managers WHERE id = ?`).run(id);
    return res.changes > 0;
  }
}
