/**
 * Repository for the `runs` table — the observability surface under auto-execute.
 *
 * Spec: docs/architecture.md §4 (observability), §7 step 6. Each run records
 * the assembled prompt, tool calls, token cost, duration, result, and the
 * parsed status block. Raw SQL + Zod row validation (tech-stack.md §4).
 *
 * Constructed with a `DatabaseSync`; tests pass an in-memory DB.
 */

import type { DatabaseSync } from 'node:sqlite';
import { RunSchema, ToolCallSchema } from '@shared/schemas/run-schema';
import type { Run, RuleStatus } from '@shared/types';

/** Fields accepted when recording a run (auto-increment id; endedAt computed). */
export interface NewRun {
  ruleId: string;
  trigger: Run['trigger'];
  startedAt: string;
  endedAt?: string;
  status: Run['status'];
  prompt: string;
  toolCalls?: Run['toolCalls'];
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  result?: string;
  parsedStatus?: { status: RuleStatus; reason?: string };
  error?: string;
  eventPayload?: Record<string, unknown>;
}

interface RunRow {
  id: number;
  rule_id: string;
  trigger: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  prompt: string;
  tool_calls: string;
  input_tokens: number | null;
  output_tokens: number | null;
  duration_ms: number | null;
  result: string | null;
  parsed_status: string | null;
  error: string | null;
  event_payload: string | null;
}

function rowToRun(row: RunRow): Run {
  return RunSchema.parse({
    id: row.id,
    ruleId: row.rule_id,
    trigger: row.trigger as Run['trigger'],
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    status: row.status as Run['status'],
    prompt: row.prompt,
    toolCalls: JSON.parse(row.tool_calls) as Run['toolCalls'],
    inputTokens: row.input_tokens ?? undefined,
    outputTokens: row.output_tokens ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    result: row.result ?? undefined,
    parsedStatus: row.parsed_status
      ? (JSON.parse(row.parsed_status) as NonNullable<Run['parsedStatus']>)
      : undefined,
    error: row.error ?? undefined,
    eventPayload: row.event_payload ?? undefined,
  });
}

export class RunsRepository {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Insert a run record. Returns the inserted row id.
   */
  create(run: NewRun): number {
    const toolCalls = ToolCallSchema.array().parse(run.toolCalls ?? []);
    const res = this.db
      .prepare(
        `INSERT INTO runs (rule_id, trigger, started_at, ended_at, status, prompt,
                           tool_calls, input_tokens, output_tokens, duration_ms,
                           result, parsed_status, error, event_payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.ruleId,
        run.trigger,
        run.startedAt,
        run.endedAt ?? null,
        run.status,
        run.prompt,
        JSON.stringify(toolCalls),
        run.inputTokens ?? null,
        run.outputTokens ?? null,
        run.durationMs ?? null,
        run.result ?? null,
        run.parsedStatus ? JSON.stringify(run.parsedStatus) : null,
        run.error ?? null,
        run.eventPayload ? JSON.stringify(run.eventPayload) : null,
      );
    // node:sqlite returns lastInsertRowid as number for INTEGER PK.
    return Number(res.lastInsertRowid);
  }

  /** Get one run by id, or null. */
  get(id: number): Run | null {
    const row = this.db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as RunRow | undefined;
    return row ? rowToRun(row) : null;
  }

  /** List recent runs, optionally filtered by rule id. Newest first. */
  list(ruleId: string | null, limit = 100): Run[] {
    const sql = ruleId
      ? `SELECT * FROM runs WHERE rule_id = ? ORDER BY id DESC LIMIT ?`
      : `SELECT * FROM runs ORDER BY id DESC LIMIT ?`;
    const stmt = this.db.prepare(sql);
    const rows = (ruleId ? stmt.all(ruleId, limit) : stmt.all(limit)) as unknown as RunRow[];
    return rows.map(rowToRun);
  }
}
