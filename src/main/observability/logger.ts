/**
 * Structured main-process logger (electron-log with rotation).
 *
 * Spec: docs/tech-stack.md §2, docs/architecture.md §8. Observability is the
 * safety net under auto-execute (no pre-write approval gate), so the main
 * process logs to rotating files at ~/Library/Logs/<app>/ on macOS.
 *
 * electron-log is imported lazily so that pure-logic modules that import this
 * logger indirectly remain unit-testable without the Electron runtime — but
 * the logger itself only works inside a running Electron app.
 */

import log from 'electron-log';

// File logging with daily rotation + a sane max size (electron-log defaults are
// reasonable; we make them explicit).
log.transports.file.level = 'info';
log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB per file

// Console mirroring is handy in dev; disable in production to keep stdout clean.
log.transports.console.level = 'debug';

/** The app-wide logger. */
export const logger = log;

/** Convenience: log an error with an attached cause. */
export function logError(msg: string, cause?: unknown): void {
  if (cause instanceof Error) logger.error(`${msg}: ${cause.message}`, cause);
  else logger.error(msg, cause);
}
