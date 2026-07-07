/**
 * Per-run workdir staging + teardown.
 *
 * Spec: docs/architecture.md §6.1, §8; docs/tech-stack.md §6.3; docs/mcp-servers.md §5.2.
 *
 * For CODEX runs (architecture.md §6.1), the workdir holds a generated
 * `.codex/config.toml` declaring the rule's MCP servers AND `approval_policy =
 * "never"`. That file contains plaintext tokens (mcp-servers.md §8), so the
 * workdir MUST be deleted at run teardown — this is a security-critical
 * cleanup (architecture.md §8, tech-stack.md §6.3). Claude uses per-call config
 * and writes nothing to disk, so staging is lighter for it.
 *
 * Path layout: `<appData>/runs/<rule-id>/<timestamp>/`.
 */

import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedMcpServers, Rule } from '@shared/types';
import { serializeForCodex, assertNoPlaceholders } from '../mcp/config.js';

export interface StagedRun {
  /** Absolute path to the per-run workdir. */
  workdir: string;
  /** Resolve the rule's effective workdir (cwd for the agent session). */
  cwd: string;
  /** Teardown: delete the per-run workdir. SECURITY-CRITICAL for Codex. */
  cleanup: () => void;
}

export interface StageOptions {
  /** Root dir under which per-run workdirs live (e.g. ~/.localcortex/runs). */
  runsRoot: string;
  /** Used by the caller to make timestamps deterministic in tests. */
  now?: () => Date;
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
 * Prepare a per-run staged workdir for a Codex run:
 *   - creates `<runsRoot>/<ruleId>/<timestamp>/`;
 *   - writes `.codex/config.toml` with the resolved MCP servers and
 *     `approval_policy = "never"`.
 *
 * For Claude, staging is a no-op (per-call config; nothing written to disk),
 * but callers may still use this to get a scratch workdir.
 *
 * SECURITY: always call `cleanup()` on the returned object when the run ends,
 * to delete the staged dir (which may contain plaintext tokens for Codex).
 */
export function stageCodexRun(
  rule: Pick<Rule, 'id'>,
  servers: ResolvedMcpServers,
  opts: StageOptions,
): StagedRun {
  // Validate before writing tokens to disk.
  assertNoPlaceholders(servers);

  const ts = (opts.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const workdir = join(opts.runsRoot, rule.id, ts);
  mkdirSync(workdir, { recursive: true });

  const codexDir = join(workdir, '.codex');
  mkdirSync(codexDir, { recursive: true });
  const toml = serializeForCodex(servers, { approvalPolicy: 'never' });
  writeFileSync(join(codexDir, 'config.toml'), toml, { encoding: 'utf8', mode: 0o600 });

  return {
    workdir,
    cwd: workdir,
    cleanup: () => {
      if (existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
    },
  };
}

/**
 * Prepare a (lightweight) staged run for a Claude run. Claude needs no config
 * file (per-call mcpServers), so this just ensures the cwd exists and returns
 * a no-op cleanup. Provided for symmetry so the run-loop can treat both
 * backends uniformly.
 */
export function stageClaudeRun(rule: Pick<Rule, 'workdir' | 'id'>, scratchRoot: string): StagedRun {
  const cwd = resolveCwd(rule, scratchRoot);
  mkdirSync(cwd, { recursive: true });
  return { workdir: cwd, cwd, cleanup: () => {} };
}
