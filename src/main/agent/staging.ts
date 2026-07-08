/**
 * Per-run workdir staging + teardown.
 *
 * Spec: docs/architecture.md §6.1.
 *
 * Both backends now receive MCP config per-call (Claude via `options.mcpServers`,
 * Codex via the SDK `config` option → `--config` flags), so staging writes
 * nothing to disk and has no token-bearing teardown. This module only resolves
 * the agent's working directory (honoring `rule.workdir` when set, falling back
 * to a per-rule scratch dir) and ensures it exists.
 *
 * Path layout for the fallback: `<appData>/work/<rule-id>/`.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Rule } from '@shared/types';

export interface StagedRun {
  /** Absolute path to the per-run workdir. */
  workdir: string;
  /** Resolve the rule's effective workdir (cwd for the agent session). */
  cwd: string;
  /** Teardown: no-op now that nothing is written to disk. Kept for symmetry. */
  cleanup: () => void;
}

/**
 * Resolve the rule's effective cwd (the directory the agent runs IN).
 * Falls back to a per-rule scratch dir when `rule.workdir` is unset
 * (rule-config-schema.md §6).
 */
export function resolveCwd(rule: Pick<Rule, 'workdir' | 'id'>, scratchRoot: string): string {
  if (rule.workdir && rule.workdir.trim().length > 0) return rule.workdir;
  return join(scratchRoot, 'work', rule.id);
}

/**
 * Prepare the agent's working directory for a run: ensure the cwd exists and
 * return a no-op cleanup. Both backends use this; neither writes config to disk
 * (Claude and Codex both take MCP config per-call — arch §5.5).
 */
export function stageRun(rule: Pick<Rule, 'workdir' | 'id'>, scratchRoot: string): StagedRun {
  const cwd = resolveCwd(rule, scratchRoot);
  mkdirSync(cwd, { recursive: true });
  return { workdir: cwd, cwd, cleanup: () => {} };
}
