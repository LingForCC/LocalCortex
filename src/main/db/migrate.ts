/**
 * Versioned SQL migration runner.
 *
 * Spec: docs/tech-stack.md §4. Versioned migrations applied in order, with a
 * `schema_version` table tracking which version is applied. NOT via drizzle-kit
 * (which has NODE_MODULE_VERSION issues in Electron, and we don't use it).
 *
 * Migrations are inlined into the bundle via Vite's `?raw` import so the runner
 * works identically in dev, in the packaged app, and in tests — no filesystem
 * path to resolve (which the Vite/Electron bundling would otherwise break).
 * To add a migration: create `NNN_name.sql`, import it raw below, and register
 * it in MIGRATIONS.
 */

import type { DatabaseSync } from 'node:sqlite';
import initialSql from './migrations/001_initial.sql?raw';
import handoffsSql from './migrations/002_handoffs.sql?raw';
import handoffsEnabledSql from './migrations/003_handoffs_enabled.sql?raw';
import catalogSql from './migrations/004_catalog.sql?raw';
import ruleModelOverridesSql from './migrations/005_rule_model_overrides.sql?raw';
import handoffProfilesSql from './migrations/006_handoff_profiles.sql?raw';
import handoffProfilesRenameSql from './migrations/007_handoff_profiles_rename.sql?raw';
import claudeCodeAgentSql from './migrations/008_claude_code_agent.sql?raw';
import taskManagerCreateInstructionsSql from './migrations/009_task_manager_create_instructions.sql?raw';

/** A single migration: a version number + the SQL to apply. */
interface Migration {
  version: number;
  sql: string;
}

/**
 * The ordered list of migrations. Adding a new one is a code change here
 * (import the `.sql?raw` and append), which keeps the set explicit and
 * reviewable rather than discovered from disk.
 */
const MIGRATIONS: Migration[] = [
  { version: 1, sql: initialSql },
  { version: 2, sql: handoffsSql },
  { version: 3, sql: handoffsEnabledSql },
  { version: 4, sql: catalogSql },
  { version: 5, sql: ruleModelOverridesSql },
  { version: 6, sql: handoffProfilesSql },
  { version: 7, sql: handoffProfilesRenameSql },
  { version: 8, sql: claudeCodeAgentSql },
  { version: 9, sql: taskManagerCreateInstructionsSql },
];

/** Result of running migrations. */
export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  applied: number[];
}

/** Read the current applied version from the DB (0 if none). */
export function currentVersion(db: DatabaseSync): number {
  // schema_version may not exist yet (first run before any migration).
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'`)
    .get() as { name?: string } | undefined;
  if (!row?.name) return 0;
  const v = db.prepare(`SELECT MAX(version) AS v FROM schema_version`).get() as {
    v: number | null;
  };
  return v.v ?? 0;
}

/**
 * Conditionally rename the legacy `handoff_combos` table (created by the
 * pre-rename migration 006) to `handoff_profiles`, and rewrite the legacy
 * migrated row id. No-op when `handoff_combos` doesn't exist (fresh DBs, or the
 * rename already ran). Called from within migration 7's transaction.
 */
function applyHandoffProfilesRename(db: DatabaseSync): void {
  const hasOld = (
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='handoff_combos'`)
      .get() as { 1?: number } | undefined
  ) !== undefined;
  if (!hasOld) return;

  const hasNew = (
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='handoff_profiles'`)
      .get() as { 1?: number } | undefined
  ) !== undefined;
  if (hasNew) {
    // Both exist — shouldn't happen normally. Drop the old one to avoid leaving
    // an orphan rather than risk duplicating data.
    db.exec(`DROP TABLE handoff_combos`);
    return;
  }

  db.exec(`ALTER TABLE handoff_combos RENAME TO handoff_profiles`);
  // Rewrite the legacy migrated row id so it matches what the renamed
  // migration 006 produces on a fresh DB.
  db.prepare(
    `UPDATE handoff_profiles SET id = 'profile-handoff-auto' WHERE id = 'combo-handoff-auto'`,
  ).run();
}

/**
 * Apply all pending migrations, in order, each in its own transaction.
 * Idempotent: if everything is applied, this is a no-op.
 */
export function runMigrations(db: DatabaseSync): MigrationResult {
  const fromVersion = currentVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > fromVersion).sort(
    (a, b) => a.version - b.version,
  );

  for (const m of pending) {
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      // Migration 7 renames the legacy handoff_combos table (created by the
      // pre-rename migration 006) to handoff_profiles. This is done here rather
      // than in the SQL body because pure SQL can't reference a table that may
      // not exist — fresh DBs never had handoff_combos, so any `ALTER TABLE
      // handoff_combos` would error at resolve time. Guarding via sqlite_master
      // here makes it a safe no-op on fresh DBs. See 007_handoff_profiles_rename.sql.
      if (m.version === 7) {
        applyHandoffProfilesRename(db);
      }
      db.prepare(`INSERT INTO schema_version (version) VALUES (?)`).run(m.version);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Migration v${m.version} failed: ${(e as Error).message}`);
    }
  }

  return {
    fromVersion,
    toVersion: currentVersion(db),
    applied: pending.map((m) => m.version),
  };
}
