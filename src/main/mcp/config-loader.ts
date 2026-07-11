/**
 * Legacy mcp-servers.json import support.
 *
 * Spec: docs/mcp-servers.md §1-§3.
 *
 * The static ~/.localcortex/mcp-servers.json file has been retired — MCP server
 * configs now live in the `mcp_servers` DB table (migration 004). This module
 * retains only the pure JSON parser, used by `McpServersRepository.importFromFile`
 * to one-time-import a legacy file on upgrade. New code should use the repository
 * directly; do not add new file I/O here.
 */

import { McpServersFileSchema } from '@shared/schemas/mcp-config-schema';
import type { McpServersFile } from '@shared/types';

/** Parse raw file text into a validated McpServersFile. Throws on invalid JSON/schema. */
export function parseConfigFile(raw: string): McpServersFile {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`mcp-servers.json is not valid JSON: ${(e as Error).message}`);
  }
  return McpServersFileSchema.parse(json);
}
