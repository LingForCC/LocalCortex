/**
 * IPC handlers for the `servers:*` channels — read/validate mcp-servers.json.
 *
 * Spec: docs/architecture.md §4 (ipc/servers.ts), docs/mcp-servers.md.
 *
 * Lets the renderer list configured server names, flag those still holding the
 * `<your-token-here>` placeholder, and re-read the file after the user edits it.
 */

import { ipcMain } from 'electron';
import { IPC } from '@shared/schemas/ipc-schema';
import { listServerNames } from '../mcp/resolver.js';
import { serversWithPlaceholder } from '../mcp/config.js';
import { loadMcpServersFile } from '../mcp/config-loader.js';
import { resolveMcpServers } from '../mcp/resolver.js';
import type { Rule } from '@shared/types';

export interface ServersIpcDeps {
  /** Absolute path to ~/.localcortex/mcp-servers.json. */
  configPath: string;
  /** All rules — used to flag placeholder tokens on servers actually in use. */
  getRules: () => Array<Pick<Rule, 'mcpServers' | 'id'>>;
}

export function registerServersIpc(deps: ServersIpcDeps): void {
  ipcMain.handle(IPC.SERVERS_READ, async () => {
    const cfg = loadMcpServersFile(deps.configPath);
    return cfg;
  });

  ipcMain.handle(IPC.SERVERS_LIST, async () => {
    const cfg = loadMcpServersFile(deps.configPath);
    if (!cfg) return { names: [], placeholders: [] };
    const names = listServerNames(cfg);
    // Build a ResolvedMcpServers-shaped map (command/args/env) so the placeholder
    // check can scan env values.
    const resolved: Record<
      string,
      { command: string; args: string[]; env: Record<string, string> }
    > = {};
    for (const name of names) {
      const def = cfg.servers[name];
      if (def) resolved[name] = { command: def.command, args: def.args, env: def.env };
    }
    const placeholders = serversWithPlaceholder(resolved);
    return { names, placeholders };
  });

  ipcMain.handle(IPC.SERVERS_VALIDATE, async () => {
    // Validate that every rule-referenced server name exists and has no placeholder.
    const cfg = loadMcpServersFile(deps.configPath);
    if (!cfg) return { ok: false, errors: ['mcp-servers.json not found'] };
    const errors: string[] = [];
    for (const rule of deps.getRules()) {
      try {
        const resolved = resolveMcpServers({ id: rule.id, mcpServers: rule.mcpServers }, cfg);
        const ph = serversWithPlaceholder(resolved);
        for (const name of ph) {
          errors.push(`rule '${rule.id}' uses server '${name}' with a placeholder token`);
        }
      } catch (e) {
        errors.push(`rule '${rule.id}': ${(e as Error).message}`);
      }
    }
    return { ok: errors.length === 0, errors };
  });
}
