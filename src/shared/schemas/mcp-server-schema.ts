/**
 * Zod schema for a DB-backed MCP server row (the `mcp_servers` table).
 *
 * This replaces the old static ~/.localcortex/mcp-servers.json file: server
 * spawn configs now live in the DB and are editable in-app (Sources tab,
 * form + JSON-paste modes). `McpServersRepository.getAsConfig()` produces the
 * same `McpServersFile`-shaped object the resolver/serializers consume, so the
 * downstream machinery is unchanged.
 *
 * Spec: docs/features/mcp-sources/README.md.
 */

import { z } from 'zod';

export const McpServerEntrySchema = z.object({
  /** Server name — what rules reference in `rule.mcpServers`. Primary key. */
  name: z.string().trim().min(1),
  transport: z.literal('stdio').default('stdio'),
  command: z.string().trim().min(1),
  args: z.array(z.string()).default([]),
  /** Holds credential values as plaintext (same posture as the old file). */
  env: z.record(z.string(), z.string()).default({}),
  /** Seeded defaults are editable but not deletable. */
  isBuiltin: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * Input shape for create/update (no timestamps; isBuiltin defaults to false).
 * Used by the mcp-servers:upsert IPC channel.
 */
export const McpServerInputSchema = McpServerEntrySchema.omit({
  createdAt: true,
  updatedAt: true,
});
