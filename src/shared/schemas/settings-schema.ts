/**
 * Zod schema for global app settings, stored in the `app_settings` table.
 *
 * Covers the global tick interval default (arch §6.5) and the concurrency cap
 * (arch §6.4). Rendered in the Settings view.
 */

import { z } from 'zod';
import {
  DEFAULT_TICK_INTERVAL_SECONDS,
  MIN_TICK_INTERVAL_SECONDS,
  DEFAULT_CONCURRENCY,
} from '../constants.js';

export const AppSettingsSchema = z.object({
  /** Global default tick interval (seconds). Applies when a rule omits its own. */
  tickIntervalSeconds: z
    .number()
    .int()
    .positive()
    .min(MIN_TICK_INTERVAL_SECONDS)
    .default(DEFAULT_TICK_INTERVAL_SECONDS),
  /** Max concurrent agent runs across scheduler + event paths. */
  concurrency: z.number().int().positive().default(DEFAULT_CONCURRENCY),
  /** Optional shared secret required in the ingress POST header (arch §8). */
  ingressSecret: z.string().optional(),
  /**
   * Optional explicit path to a locally installed `codex` CLI. When unset/
   * empty, the runner auto-detects on PATH and otherwise falls back to the
   * SDK's bundled vendored binary (arch §6.5.1).
   */
  codexCliPath: z.string().optional(),
  /**
   * Optional explicit path to a locally installed `claude` (Claude Code) CLI.
   * Same resolution semantics as `codexCliPath` (arch §6.5.1).
   */
  claudeCliPath: z.string().optional(),
});
