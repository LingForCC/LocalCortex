/**
 * Bundled default mcp-servers.json, written to ~/.localcortex/mcp-servers.json
 * on first launch if the file does not exist.
 *
 * Spec: docs/mcp-servers.md §3 — the three v1 servers with empty token
 * placeholders the user replaces. (The bundled OmniFocus JXA sink has been
 * removed; configure any task manager as an external MCP server in the file.)
 */

import type { McpServersFile } from '@shared/types';
import { PLACEHOLDER_TOKEN } from '@shared/constants';

/**
 * Build the default config. No parameters: the default ships only
 * token-placeholder servers resolved from constants. Any sink (OmniFocus,
 * Todoist, etc.) is configured by the user as an external MCP server in the
 * written file.
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
