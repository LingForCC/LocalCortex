/**
 * Repository for the `rules` table.
 *
 * Spec: docs/tech-stack.md §4 (raw SQL + Zod row validation). Every query is
 * raw SQL; every returned row is parsed through the `Rule` schema to get a
 * typed object. JSON columns (`trigger_json`, `mcp_servers_json`) are
 * (de)serialized here so callers see the structured shape.
 *
 * The repository is constructed with a `DatabaseSync` instance — tests pass an
 * in-memory DB; the main process passes the real file-backed one. The repo
 * does NOT import `electron`.
 */

import type { DatabaseSync } from 'node:sqlite';
import { RuleSchema } from '@shared/schemas/rule-schema';
import type { Rule, Trigger, McpServerName, RuleWithBookkeeping } from '@shared/types';

/** Row shape as it comes out of SQLite (before normalization). */
interface RuleRow {
  id: string;
  name: string;
  enabled: number;
  rule: string;
  trigger_json: string;
  mcp_servers_json: string;
  backend: string;
  model: string | null;
  model_reasoning_effort: string | null;
  workdir: string | null;
  sandbox: string;
  max_runs: number | null;
  expires_at: string | null;
  notes: string | null;
  run_count: number;
  disable_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** Convert a raw DB row into a validated Rule. */
export function rowToRule(row: RuleRow): Rule {
  return RuleSchema.parse({
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    rule: row.rule,
    trigger: JSON.parse(row.trigger_json) as Trigger,
    mcpServers: JSON.parse(row.mcp_servers_json) as McpServerName[],
    backend: row.backend as Rule['backend'],
    model: row.model ?? undefined,
    modelReasoningEffort: (row.model_reasoning_effort ?? undefined) as Rule['modelReasoningEffort'],
    workdir: row.workdir ?? undefined,
    sandbox: row.sandbox as Rule['sandbox'],
    maxRuns: row.max_runs,
    expiresAt: row.expires_at ?? undefined,
    notes: row.notes ?? undefined,
  });
}

/** Extra bookkeeping fields exposed alongside the rule. */
export type { RuleWithBookkeeping } from '@shared/types';

function rowToRuleWithBookkeeping(row: RuleRow): RuleWithBookkeeping {
  const rule = rowToRule(row);
  const out: RuleWithBookkeeping = {
    ...rule,
    runCount: row.run_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.disable_reason) out.disableReason = row.disable_reason;
  return out;
}

export class RulesRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** Get all rules (with bookkeeping), ordered by name. */
  list(): RuleWithBookkeeping[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, enabled, rule, trigger_json, mcp_servers_json, backend,
                model, model_reasoning_effort, workdir, sandbox, max_runs, expires_at,
                notes, run_count, disable_reason, created_at, updated_at
         FROM rules ORDER BY name ASC`,
      )
      .all() as unknown as RuleRow[];
    return rows.map(rowToRuleWithBookkeeping);
  }

  /** Get one rule by id (with bookkeeping), or null. */
  get(id: string): RuleWithBookkeeping | null {
    const row = this.db
      .prepare(
        `SELECT id, name, enabled, rule, trigger_json, mcp_servers_json, backend,
                model, model_reasoning_effort, workdir, sandbox, max_runs, expires_at,
                notes, run_count, disable_reason, created_at, updated_at
         FROM rules WHERE id = ?`,
      )
      .get(id) as RuleRow | undefined;
    return row ? rowToRuleWithBookkeeping(row) : null;
  }

  /** Insert a new rule (validated). Throws on PK conflict. */
  create(rule: Rule): void {
    const parsed = RuleSchema.parse(rule);
    this.db
      .prepare(
        `INSERT INTO rules (id, name, enabled, rule, trigger_json, mcp_servers_json,
                            backend, model, model_reasoning_effort, workdir, sandbox,
                            max_runs, expires_at, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.id,
        parsed.name,
        parsed.enabled ? 1 : 0,
        parsed.rule,
        JSON.stringify(parsed.trigger),
        JSON.stringify(parsed.mcpServers),
        parsed.backend,
        parsed.model ?? null,
        parsed.modelReasoningEffort ?? null,
        parsed.workdir ?? null,
        parsed.sandbox,
        parsed.maxRuns ?? null,
        parsed.expiresAt ?? null,
        parsed.notes ?? null,
      );
  }

  /** Update an existing rule (validated). No-op if the id doesn't exist. */
  update(rule: Rule): boolean {
    const parsed = RuleSchema.parse(rule);
    const res = this.db
      .prepare(
        `UPDATE rules SET
            name = ?, enabled = ?, rule = ?, trigger_json = ?, mcp_servers_json = ?,
            backend = ?, model = ?, model_reasoning_effort = ?, workdir = ?,
            sandbox = ?, max_runs = ?, expires_at = ?, notes = ?,
            updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        parsed.name,
        parsed.enabled ? 1 : 0,
        parsed.rule,
        JSON.stringify(parsed.trigger),
        JSON.stringify(parsed.mcpServers),
        parsed.backend,
        parsed.model ?? null,
        parsed.modelReasoningEffort ?? null,
        parsed.workdir ?? null,
        parsed.sandbox,
        parsed.maxRuns ?? null,
        parsed.expiresAt ?? null,
        parsed.notes ?? null,
        parsed.id,
      );
    return res.changes > 0;
  }

  /** Delete a rule by id. Returns true if a row was removed. */
  delete(id: string): boolean {
    const res = this.db.prepare(`DELETE FROM rules WHERE id = ?`).run(id);
    return res.changes > 0;
  }

  /** Enable or disable a rule, optionally recording a disable reason. */
  setEnabled(id: string, enabled: boolean, disableReason?: string): boolean {
    const res = this.db
      .prepare(
        `UPDATE rules SET enabled = ?, disable_reason = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(enabled ? 1 : 0, enabled ? null : (disableReason ?? null), id);
    return res.changes > 0;
  }

  /**
   * Increment a rule's run counter. Returns the new count, or null if the
   * rule doesn't exist.
   */
  incrementRunCount(id: string): number | null {
    const res = this.db.prepare(`UPDATE rules SET run_count = run_count + 1 WHERE id = ?`).run(id);
    if (res.changes === 0) return null;
    const row = this.db.prepare(`SELECT run_count FROM rules WHERE id = ?`).get(id) as
      | {
          run_count: number;
        }
      | undefined;
    return row?.run_count ?? null;
  }

  /** Reset a rule's run counter (e.g. on manual re-enable). */
  resetRunCount(id: string): void {
    this.db.prepare(`UPDATE rules SET run_count = 0, disable_reason = NULL WHERE id = ?`).run(id);
  }
}
