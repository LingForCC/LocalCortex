/**
 * Serializes resolved MCP server configs into the two backend-specific formats.
 *
 * Spec: docs/mcp-servers.md §5.
 *  - Claude Agent SDK: per-call `options.mcpServers` dict (§5.1).
 *  - Codex SDK: a `.codex/config.toml` written into the run workdir (§5.2),
 *    including `approval_policy = "never"` (arch §6.3).
 *
 * Also enforces the placeholder-token check (§5.3): if any env value in a
 * resolved server is still `<your-token-here>`, the run must fail fast with a
 * clear message rather than a cryptic MCP auth error.
 *
 * Pure logic — no `electron` import, unit-testable.
 */

import type { ResolvedMcpServers } from '@shared/types';
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
 * Serialize resolved servers into a Codex `.codex/config.toml` string.
 *
 * Per docs/mcp-servers.md §5.2:
 *   [mcp_servers.<name>]
 *   command = "..."
 *   args = ["..."]
 *   [mcp_servers.<name>.env]
 *   KEY = "..."
 * plus `approval_policy = "never"` (arch §6.3).
 *
 * Server names and env values are TOML-double-quoted and escaped; dots in names
 * are handled by always quoting the name segment (TOML bare keys can't contain
 * dots, so a quoted key is required for `github-personal`-style names with `-`,
 * and harmless otherwise).
 */
export function serializeForCodex(
  servers: ResolvedMcpServers,
  opts: { approvalPolicy?: 'never' | 'on-request' | 'on-failure' } = {},
): string {
  const approvalPolicy = opts.approvalPolicy ?? 'never';
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
  lines.push(`approval_policy = ${tomlString(approvalPolicy)}`);
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
