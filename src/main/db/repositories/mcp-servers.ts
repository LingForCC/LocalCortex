/**
 * Repository for the `mcp_servers` table.
 *
 * Replaces the old ~/.localcortex/mcp-servers.json file as the single source
 * of truth for MCP server spawn configs. `getAsConfig()` returns the same
 * `McpServersFile`-shaped object the resolver/serializers expect, so the
 * downstream MCP machinery is unchanged.
 *
 * Spec: docs/features/mcp-sources/README.md. Follows the same raw-SQL +
 * Zod-row-validation pattern as the rules/handoffs repositories. Does NOT
 * import `electron`.
 */

import type { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { McpServerEntrySchema } from '@shared/schemas/mcp-server-schema';
import type { McpServerEntry, McpServersFile } from '@shared/types';
import { PLACEHOLDER_TOKEN } from '@shared/constants';

/** Row shape as it comes out of SQLite (before normalization). */
interface McpServerRow {
  name: string;
  transport: string;
  command: string;
  args_json: string;
  env_json: string;
  is_builtin: number;
  created_at: string;
  updated_at: string;
}

/** Convert a raw DB row into a validated McpServerEntry. */
export function rowToMcpServerEntry(row: McpServerRow): McpServerEntry {
  return McpServerEntrySchema.parse({
    name: row.name,
    transport: row.transport as 'stdio',
    command: row.command,
    args: JSON.parse(row.args_json) as string[],
    env: JSON.parse(row.env_json) as Record<string, string>,
    isBuiltin: row.is_builtin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class McpServersRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** All servers, ordered by name. */
  list(): McpServerEntry[] {
    const rows = this.db
      .prepare(
        `SELECT name, transport, command, args_json, env_json, is_builtin, created_at, updated_at
         FROM mcp_servers ORDER BY name ASC`,
      )
      .all() as unknown as McpServerRow[];
    return rows.map(rowToMcpServerEntry);
  }

  /** One server by name, or null. */
  getByName(name: string): McpServerEntry | null {
    const row = this.db
      .prepare(
        `SELECT name, transport, command, args_json, env_json, is_builtin, created_at, updated_at
         FROM mcp_servers WHERE name = ?`,
      )
      .get(name) as McpServerRow | undefined;
    return row ? rowToMcpServerEntry(row) : null;
  }

  /**
   * Return all servers as a `McpServersFile`-shaped object — the same shape the
   * resolver (`resolveMcpServers`) and per-backend serializers expect. This is
   * the bridge between the DB source and the unchanged MCP machinery.
   */
  getAsConfig(): McpServersFile {
    const entries = this.list();
    const servers: McpServersFile['servers'] = {};
    for (const e of entries) {
      servers[e.name] = {
        transport: e.transport,
        command: e.command,
        args: e.args,
        env: e.env,
      };
    }
    return { servers };
  }

  /**
   * The set of server names still holding the placeholder token (i.e. not yet
   * configured by the user). Used by the Sources view + lifecycle manager.
   */
  placeholderNames(): string[] {
    return this.list()
      .filter((e) => Object.values(e.env).some((v) => v.includes(PLACEHOLDER_TOKEN)))
      .map((e) => e.name);
  }

  /**
   * Insert or update a server by name. On conflict, all fields (including
   * isBuiltin) are overwritten. Returns the canonical row.
   */
  upsert(input: Omit<McpServerEntry, 'createdAt' | 'updatedAt'>): McpServerEntry {
    const parsed = McpServerEntrySchema.omit({ createdAt: true, updatedAt: true }).parse(input);
    this.db
      .prepare(
        `INSERT INTO mcp_servers (name, transport, command, args_json, env_json, is_builtin,
                                  created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(name) DO UPDATE SET
           transport = excluded.transport,
           command = excluded.command,
           args_json = excluded.args_json,
           env_json = excluded.env_json,
           is_builtin = excluded.is_builtin,
           updated_at = datetime('now')`,
      )
      .run(
        parsed.name,
        parsed.transport,
        parsed.command,
        JSON.stringify(parsed.args),
        JSON.stringify(parsed.env),
        parsed.isBuiltin ? 1 : 0,
      );
    return this.getByName(parsed.name)!;
  }

  /** Delete a server by name. Returns true if a row was removed. */
  delete(name: string): boolean {
    const res = this.db.prepare(`DELETE FROM mcp_servers WHERE name = ?`).run(name);
    return res.changes > 0;
  }

  /**
   * One-time import from a legacy ~/.localcortex/mcp-servers.json file. If the
   * file exists, parse it and upsert every server (idempotent by name). Servers
   * already present in the DB (e.g. seeded by migration 004) are overwritten by
   * the file's definition, preserving the user's existing tokens. Imported
   * servers are marked `isBuiltin` to match the file's prior default posture.
   * No-op (returns 0) if the file does not exist.
   */
  importFromFile(path: string): number {
    if (!existsSync(path)) return 0;
    const raw = readFileSync(path, 'utf8');
    let json: { servers?: Record<string, unknown> };
    try {
      json = JSON.parse(raw) as { servers?: Record<string, unknown> };
    } catch {
      return 0; // malformed file — leave seeds intact
    }
    const servers = json.servers;
    if (!servers || typeof servers !== 'object') return 0;
    let count = 0;
    for (const [name, cfg] of Object.entries(servers)) {
      if (!cfg || typeof cfg !== 'object') continue;
      const c = cfg as { command?: string; args?: string[]; env?: Record<string, string> };
      if (!c.command) continue;
      this.upsert({
        name,
        transport: 'stdio',
        command: c.command,
        args: Array.isArray(c.args) ? c.args : [],
        env: c.env ?? {},
        isBuiltin: true,
      });
      count++;
    }
    return count;
  }
}
