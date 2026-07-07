/**
 * Resolves a rule's `mcpServers` names into concrete spawn configs.
 *
 * Spec: docs/mcp-servers.md §4 (resolution algorithm).
 *
 * For each server name in `rule.mcpServers`:
 *   1. look it up in the user's mcp-servers.json;
 *   2. if missing → throw a clear error naming the missing server;
 *   3. copy out a fresh { command, args, env } (deep enough for our use) so the
 *      caller may mutate without touching the source file's in-memory copy.
 *
 * Pure logic — operates on already-parsed config; no `electron` import.
 */

import type { Rule, McpServersFile, ResolvedMcpServers } from '@shared/types';

/** Thrown when a rule references an undefined server name. */
export class UndefinedMcpServerError extends Error {
  constructor(
    public readonly serverName: string,
    public readonly ruleId: string,
  ) {
    super(
      `Server '${serverName}' is not defined in mcp-servers.json (referenced by rule '${ruleId}').`,
    );
    this.name = 'UndefinedMcpServerError';
  }
}

/**
 * Resolve `rule.mcpServers` against `config`.
 * @throws {UndefinedMcpServerError} if any name is missing.
 */
export function resolveMcpServers(
  rule: Pick<Rule, 'mcpServers' | 'id'>,
  config: McpServersFile,
): ResolvedMcpServers {
  const resolved: ResolvedMcpServers = {};
  for (const name of rule.mcpServers) {
    const def = config.servers[name];
    if (!def) throw new UndefinedMcpServerError(name, rule.id);
    resolved[name] = {
      command: def.command,
      args: [...def.args],
      env: { ...def.env },
    };
  }
  return resolved;
}

/** Names defined in the config file (for UI listing / validation). */
export function listServerNames(config: McpServersFile): string[] {
  return Object.keys(config.servers);
}
