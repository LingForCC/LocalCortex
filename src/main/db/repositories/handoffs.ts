/**
 * Repository for the `pending_reviews` table (handoffs).
 *
 * Spec: docs/tech-stack.md §4 (raw SQL + Zod row validation). Mirrors the
 * `rules` repository pattern: every query is raw SQL, every returned row is
 * parsed through `HandoffSchema`. The JSON column `context_json` is
 * (de)serialized here so callers see the structured `Record<string,string>`.
 *
 * Constructed with a `DatabaseSync` instance — tests pass an in-memory DB; the
 * main process passes the real file-backed one. Does NOT import `electron`.
 */

import type { DatabaseSync } from 'node:sqlite';
import { HandoffSchema } from '@shared/schemas/handoff-schema';
import type { Handoff } from '@shared/types';

/** Row shape as it comes out of SQLite (before normalization). */
interface HandoffRow {
  id: string;
  session_id: string;
  context_json: string;
  reminder_title: string | null;
  status: string;
  rule_id: string | null;
  fulfilled_run_id: number | null;
  created_at: string;
  updated_at: string;
}

/** Convert a raw DB row into a validated Handoff. */
export function rowToHandoff(row: HandoffRow): Handoff {
  const parsed = HandoffSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    context: JSON.parse(row.context_json) as Record<string, string>,
    reminderTitle: row.reminder_title ?? undefined,
    status: row.status as Handoff['status'],
    ruleId: row.rule_id ?? undefined,
    fulfilledRunId: row.fulfilled_run_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  return parsed;
}

export class HandoffsRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** All handoffs, newest first. */
  list(): Handoff[] {
    const rows = this.db
      .prepare(
        `SELECT id, session_id, context_json, reminder_title, status, rule_id,
                fulfilled_run_id, created_at, updated_at
         FROM pending_reviews ORDER BY created_at DESC`,
      )
      .all() as unknown as HandoffRow[];
    return rows.map(rowToHandoff);
  }

  /** One handoff by id, or null. */
  get(id: string): Handoff | null {
    const row = this.db
      .prepare(
        `SELECT id, session_id, context_json, reminder_title, status, rule_id,
                fulfilled_run_id, created_at, updated_at
         FROM pending_reviews WHERE id = ?`,
      )
      .get(id) as HandoffRow | undefined;
    return row ? rowToHandoff(row) : null;
  }

  /**
   * The most recent pending handoff for a given sessionId, or null.
   *
   * This is the completion-time correlation key: when a session-complete event
   * arrives, the ingress looks up the handoff by `payload.sessionId` here.
   * Only `pending` handoffs match (fulfilled/cancelled ones are inert), which
   * makes enrichment idempotent even if a Stop hook fires repeatedly.
   */
  findPendingBySessionId(sessionId: string): Handoff | null {
    const row = this.db
      .prepare(
        `SELECT id, session_id, context_json, reminder_title, status, rule_id,
                fulfilled_run_id, created_at, updated_at
         FROM pending_reviews
         WHERE session_id = ? AND status = 'pending'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(sessionId) as HandoffRow | undefined;
    return row ? rowToHandoff(row) : null;
  }

  /** Insert a new handoff (validated). Throws on PK conflict. */
  create(handoff: Handoff): void {
    const parsed = HandoffSchema.parse(handoff);
    this.db
      .prepare(
        `INSERT INTO pending_reviews (id, session_id, context_json, reminder_title,
                                      status, rule_id, fulfilled_run_id,
                                      created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.id,
        parsed.sessionId,
        JSON.stringify(parsed.context),
        parsed.reminderTitle ?? null,
        parsed.status,
        parsed.ruleId ?? null,
        parsed.fulfilledRunId ?? null,
        parsed.createdAt,
        parsed.updatedAt,
      );
  }

  /** Delete a handoff by id. Returns true if a row was removed. */
  delete(id: string): boolean {
    const res = this.db.prepare(`DELETE FROM pending_reviews WHERE id = ?`).run(id);
    return res.changes > 0;
  }

  /**
   * Mark a handoff fulfilled by the given run. Records which run fulfilled it
   * and flips status so it won't fire again (idempotency guard). Optionally
   * records the rule that ran. Returns true if a row was updated.
   */
  markFulfilled(id: string, runId: number, ruleId?: string): boolean {
    const res = this.db
      .prepare(
        `UPDATE pending_reviews
         SET status = 'fulfilled', fulfilled_run_id = ?, rule_id = COALESCE(?, rule_id),
             updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(runId, ruleId ?? null, id);
    return res.changes > 0;
  }

  /** Cancel a handoff (it will no longer fire). Returns true if a row was updated. */
  cancel(id: string): boolean {
    const res = this.db
      .prepare(
        `UPDATE pending_reviews SET status = 'cancelled', updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(id);
    return res.changes > 0;
  }
}
