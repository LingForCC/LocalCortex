/**
 * Bundled default MCP server list.
 *
 * Historically written to ~/.localcortex/mcp-servers.json on first launch by
 * `ensureConfigFile`. The file has been retired — MCP server configs now live
 * in the `mcp_servers` DB table, seeded by migration 004
 * (`src/main/db/migrations/004_catalog.sql`). The seed data there is the
 * authoritative default.
 *
 * This module is retained as a reference of the original v1 defaults and for
 * any test that wants to assert against the same shape. No production code path
 * imports it.
 */

import type { McpServersFile } from '@shared/types';
import { PLACEHOLDER_TOKEN } from '@shared/constants';

/**
 * Build the default config. The three v1 servers with empty token placeholders.
 * The user replaces these via the Sources tab (DB-backed CRUD).
 *
 * @deprecated The DB seed in migration 004 is the authoritative default now.
 */
export function buildDefaultConfig(): McpServersFile {
  return {
    servers: {
      github: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: PLACEHOLDER_TOKEN },
      },
      gitlab: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-gitlab'],
        env: {
          GITLAB_PERSONAL_ACCESS_TOKEN: PLACEHOLDER_TOKEN,
          GITLAB_API_URL: 'https://gitlab.com/api/v4',
        },
      },
      todoist: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@abhiz123/todoist-mcp-server'],
        env: { TODOIST_API_TOKEN: PLACEHOLDER_TOKEN },
      },
    },
  };
}
