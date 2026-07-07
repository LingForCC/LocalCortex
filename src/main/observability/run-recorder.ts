/**
 * Run-recorder facade over the runs repository.
 *
 * Spec: docs/architecture.md §4 (observability/), §7 step 6. The RunsRepository
 * already persists prompt/tool calls/tokens/result/status; this module adds a
 * thin, log-augmented wrapper so the run-loop has a single call site and every
 * recorded run is also surfaced in the file log.
 */

import { logger } from './logger.js';
import type { RunsRepository, NewRun } from '../db/repositories/runs.js';

/**
 * Record a completed run. Logs a summary line and returns the new run id.
 */
export function recordRun(repo: RunsRepository, run: NewRun): number {
  const id = repo.create(run);
  const ms = run.durationMs ?? 0;
  logger.info(
    `run #${id} rule=${run.ruleId} trigger=${run.trigger} status=${run.status} ` +
      `tokens=${run.inputTokens ?? '?'}/${run.outputTokens ?? '?'} ms=${ms}` +
      (run.parsedStatus ? ` parsedStatus=${run.parsedStatus.status}` : '') +
      (run.error ? ` error=${run.error}` : ''),
  );
  return id;
}
