/**
 * Repository for the `agents` table — the handoff catalog's event-source layer.
 *
 * Each row tells the app which event types to listen for and what to show the
 * user during onboarding. CRUD-able in-app, so adding a custom agent is a data
 * operation. Follows the same raw-SQL + Zod pattern as the rules repo.
 */

import type { DatabaseSync } from 'node:sqlite';
import { AgentSchema } from '@shared/schemas/agent-schema';
import type { AgentEntry } from '@shared/types';

interface AgentRow {
  id: string;
  label: string;
  description: string;
  session_complete_event_type: string;
  prompt_submit_event_type: string;
  source: string;
  install_instructions: string;
  is_builtin: number;
  created_at: string;
  updated_at: string;
}

export function rowToAgentEntry(row: AgentRow): AgentEntry {
  return AgentSchema.parse({
    id: row.id,
    label: row.label,
    description: row.description,
    sessionCompleteEventType: row.session_complete_event_type,
    promptSubmitEventType: row.prompt_submit_event_type,
    source: row.source,
    installInstructions: row.install_instructions,
    isBuiltin: row.is_builtin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class AgentsRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** All agents, ordered by label. Builtin first, then custom. */
  list(): AgentEntry[] {
    const rows = this.db
      .prepare(
        `SELECT id, label, description, session_complete_event_type, prompt_submit_event_type,
                source, install_instructions, is_builtin, created_at, updated_at
         FROM agents ORDER BY is_builtin DESC, label ASC`,
      )
      .all() as unknown as AgentRow[];
    return rows.map(rowToAgentEntry);
  }

  /** One agent by id, or null. */
  get(id: string): AgentEntry | null {
    const row = this.db
      .prepare(
        `SELECT id, label, description, session_complete_event_type, prompt_submit_event_type,
                source, install_instructions, is_builtin, created_at, updated_at
         FROM agents WHERE id = ?`,
      )
      .get(id) as AgentRow | undefined;
    return row ? rowToAgentEntry(row) : null;
  }

  /** Insert a new agent. Throws on PK conflict. */
  create(input: Omit<AgentEntry, 'createdAt' | 'updatedAt'>): void {
    const parsed = AgentSchema.omit({ createdAt: true, updatedAt: true }).parse(input);
    this.db
      .prepare(
        `INSERT INTO agents (id, label, description, session_complete_event_type,
                             prompt_submit_event_type, source, install_instructions, is_builtin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.id,
        parsed.label,
        parsed.description,
        parsed.sessionCompleteEventType,
        parsed.promptSubmitEventType,
        parsed.source,
        parsed.installInstructions,
        parsed.isBuiltin ? 1 : 0,
      );
  }

  /** Update an existing agent. No-op if the id doesn't exist. */
  update(input: Omit<AgentEntry, 'createdAt' | 'updatedAt'>): boolean {
    const parsed = AgentSchema.omit({ createdAt: true, updatedAt: true }).parse(input);
    const res = this.db
      .prepare(
        `UPDATE agents SET
            label = ?, description = ?, session_complete_event_type = ?,
            prompt_submit_event_type = ?, source = ?, install_instructions = ?,
            is_builtin = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        parsed.label,
        parsed.description,
        parsed.sessionCompleteEventType,
        parsed.promptSubmitEventType,
        parsed.source,
        parsed.installInstructions,
        parsed.isBuiltin ? 1 : 0,
        parsed.id,
      );
    return res.changes > 0;
  }

  /** Delete an agent by id. Returns true if a row was removed. */
  delete(id: string): boolean {
    const res = this.db.prepare(`DELETE FROM agents WHERE id = ?`).run(id);
    return res.changes > 0;
  }
}
