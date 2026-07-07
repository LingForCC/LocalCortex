/**
 * Zod schema for the user-editable ~/.localcortex/mcp-servers.json file.
 *
 * Spec: docs/mcp-servers.md §2. The file maps an arbitrary server name → full
 * spawn config (command, args, env with plaintext credentials). Only the
 * "stdio" transport is used in v1.
 */

import { z } from 'zod';

/** A single server definition (mcp-servers.md §2). */
export const McpServerConfigSchema = z.object({
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  /** Holds credential values as plaintext (mcp-servers.md §8). */
  env: z.record(z.string(), z.string()).default({}),
});

/** The whole file: `{ "servers": { <name>: {…} } }`. */
export const McpServersFileSchema = z.object({
  servers: z.record(z.string(), McpServerConfigSchema),
});

/**
 * A *resolved* server — the spawn config the lifecycle manager passes to the
 * SDK. Same shape as McpServerConfig minus `transport` (handled out-of-band by
 * both backends' "stdio" default), with copies of command/args/env so the
 * caller can mutate freely.
 */
export const ResolvedMcpServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()),
});
