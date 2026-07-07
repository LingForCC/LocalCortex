/**
 * SQLite client wrapper around Node's built-in `node:sqlite`.
 *
 * Spec: docs/tech-stack.md §4. Single app-owned database at
 * `<userData>/localcortex.db`. WAL + foreign keys enabled. All access goes
 * through repository modules — SQL never leaks into business logic.
 *
 * The constructor takes a path so tests can pass `:memory:`. The main process
 * resolves the real path via Electron's `app.getPath('userData')`.
 */

import { DatabaseSync } from 'node:sqlite';
import { DB_PRAGMAS } from '@shared/constants';

export type Db = DatabaseSync;

/**
 * Open (or create) a SQLite database at `path`.
 * Applies WAL + foreign-key PRAGMAs.
 */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  for (const pragma of DB_PRAGMAS) db.exec(pragma);
  return db;
}

/**
 * Open an in-memory database (for tests). Same PRAGMAs as the real one.
 */
export function openMemoryDatabase(): DatabaseSync {
  return openDatabase(':memory:');
}
