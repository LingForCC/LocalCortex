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
  APPEARANCES,
  DEFAULT_APPEARANCE,
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
  /**
   * Color scheme: `system` follows the OS `prefers-color-scheme`, `light`/`dark`
   * force a scheme. Driven via Electron's `nativeTheme.themeSource` in the main
   * process; the renderer applies it through the `prefers-color-scheme` media
   * query (styles.css).
   */
  appearance: z.enum(APPEARANCES).default(DEFAULT_APPEARANCE),
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

  // --- Handoff specialization (docs/features/handoff-setup/README.md) -------
  //
  // The three onboarding choices that auto-create the handoff rule. All
  // optional — onboarding is "complete" when all three are set. Storing them
  // in settings (not a separate table) because there's exactly one active
  // setup at a time.

  /** Chosen coding-agent catalog id (event source). */
  handoffAgentId: z.string().optional(),
  /** Chosen task-manager catalog id (sink layer). */
  handoffTaskManagerId: z.string().optional(),
  /** Which backend fulfills the review rule. Independent of the agent source. */
  handoffBackend: z.enum(['claude', 'codex']).optional(),
  /**
   * The id of the auto-created handoff rule. Stored so re-running setup updates
   * the same rule in place (idempotent) rather than creating duplicates.
   */
  handoffRuleId: z.string().optional(),
});
