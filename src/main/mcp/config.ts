/**
 * Serializes resolved MCP server configs into the two backend-specific formats.
 *
 * Spec: docs/mcp-servers.md §5.
 *  - Claude Agent SDK: per-call `options.mcpServers` dict (§5.1).
 *  - Codex SDK: per-call `options.config`, flattened by the SDK into
 *    `--config key=value` CLI flags layered on top of the user's global
 *    `~/.codex/config.toml` (§5.2). Codex reads config only from `$CODEX_HOME`,
 *    never from the workdir, so the per-run config file approach used in early
 *    versions did not work; MCP servers are now passed per-call.
 *
 * Also enforces the placeholder-token check (§5.3): if any env value in a
 * resolved server is still `<your-token-here>`, the run must fail fast with a
 * clear message rather than a cryptic MCP auth error.
 *
 * Pure logic — no `electron` import, unit-testable.
 */

import type { ResolvedMcpServers } from '@shared/types';
import type { CodexOptions } from '@openai/codex-sdk';
import { PLACEHOLDER_TOKEN } from '@shared/constants';

/** Thrown when a rule uses a server whose token hasn't been filled in. */
export class PlaceholderTokenError extends Error {
  constructor(public readonly serverNames: string[]) {
    super(
      `Servers still contain the '${PLACEHOLDER_TOKEN}' placeholder: ${serverNames.join(', ')}. ` +
        `Edit ~/.localcortex/mcp-servers.json and set real tokens before running.`,
    );
    this.name = 'PlaceholderTokenError';
  }
}

/**
 * Return the names of servers whose env still contains a placeholder token.
 * Used both for pre-run validation (throw) and UI status flags.
 */
export function serversWithPlaceholder(servers: ResolvedMcpServers): string[] {
  return Object.entries(servers)
    .filter(([, def]) => Object.values(def.env).some((v) => v === PLACEHOLDER_TOKEN))
    .map(([name]) => name);
}

/**
 * Ensure no env value in `servers` is still the placeholder.
 * @throws {PlaceholderTokenError} listing all offending server names.
 */
export function assertNoPlaceholders(servers: ResolvedMcpServers): void {
  const offenders = serversWithPlaceholder(servers);
  if (offenders.length > 0) throw new PlaceholderTokenError(offenders);
}

// --- Claude serialization (mcp-servers.md §5.1) ---------------------------

/** Shape accepted by the Claude SDK's `options.mcpServers`. */
export interface ClaudeMcpServerEntry {
  type: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function serializeForClaude(
  servers: ResolvedMcpServers,
): Record<string, ClaudeMcpServerEntry> {
  const out: Record<string, ClaudeMcpServerEntry> = {};
  for (const [name, def] of Object.entries(servers)) {
    out[name] = {
      type: 'stdio',
      command: def.command,
      args: [...def.args],
      env: { ...def.env },
    };
  }
  return out;
}

// --- Codex serialization (mcp-servers.md §5.2) ----------------------------

/**
 * Serialize resolved servers into a Codex config object passed via the SDK's
 * `options.config`. The SDK flattens it into `--config key=value` CLI flags
 * (e.g. `--config mcp_servers.omnifocus.command="npx"`) layered on top of the
 * user's global `~/.codex/config.toml`.
 *
 * `approval_policy` is NOT set here — it's a ThreadOption (approvalPolicy),
 * which the SDK emits as its own `--config` flag. Keeping it out of the servers
 * config avoids a redundant/duplicate override.
 *
 * The shape mirrors the SDK's flattener expectations (see
 * `serializeConfigOverrides` in the codex-sdk): nested plain objects recurse,
 * arrays become TOML inline arrays, and an empty `env` object emits as
 * `mcp_servers.<name>.env={}`. Dotted env keys (e.g. `my.key`) are safe here
 * because the flattener joins them as `mcp_servers.<name>.env.my.key`.
 */
export function serializeForCodexConfig(servers: ResolvedMcpServers): NonNullable<CodexOptions['config']> {
  const mcpServers: NonNullable<CodexOptions['config']> = {};
  for (const [name, def] of Object.entries(servers)) {
    mcpServers[name] = {
      command: def.command,
      args: [...def.args],
      env: { ...def.env },
    };
  }
  return { mcp_servers: mcpServers };
}

/**
 * Serialize resolved servers into a Codex `.codex/config.toml` string.
 *
 * Kept for completeness / a future iteration that may honor `rule.workdir` for
 * Codex by writing a `config.toml` there. The current runner does NOT use this —
 * it passes servers per-call via `serializeForCodexConfig` (see codex.ts),
 * because Codex reads config only from `$CODEX_HOME` (`~/.codex/config.toml`),
 * not from the workdir, so a workdir-relative file would be ignored.
 *
 * Format (docs/mcp-servers.md §5.2):
 *   [mcp_servers.<name>]
 *   command = "..."
 *   args = ["..."]
 *   [mcp_servers.<name>.env]
 *   KEY = "..."
 *
 * Server names and env values are TOML-double-quoted and escaped; dots in names
 * are handled by always quoting the name segment (TOML bare keys can't contain
 * dots, so a quoted key is required for `github-personal`-style names with `-`,
 * and harmless otherwise).
 */
export function serializeForCodex(servers: ResolvedMcpServers): string {
  const lines: string[] = [];

  for (const [name, def] of Object.entries(servers)) {
    lines.push(`[mcp_servers.${tomlQuoteKey(name)}]`);
    lines.push(`command = ${tomlString(def.command)}`);
    lines.push(`args = [${def.args.map((a) => tomlString(a)).join(', ')}]`);
    if (Object.keys(def.env).length > 0) {
      lines.push(`[mcp_servers.${tomlQuoteKey(name)}.env]`);
      for (const [k, v] of Object.entries(def.env)) {
        lines.push(`${tomlBareKey(k)} = ${tomlString(v)}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

/** Quote a TOML string value, escaping backslashes, quotes, and control chars. */
function tomlString(s: string): string {
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return `"${escaped}"`;
}

/** A TOML key wrapped in double quotes (for keys that aren't bare-key-safe). */
function tomlQuoteKey(k: string): string {
  return tomlString(k);
}

/** A TOML bare key if it's bare-safe, else a quoted key. */
function tomlBareKey(k: string): string {
  if (/^[A-Za-z0-9_-]+$/.test(k)) return k;
  return tomlQuoteKey(k);
}
