/**
 * Bundled default mcp-servers.json, written to ~/.localcortex/mcp-servers.json
 * on first launch if the file does not exist.
 *
 * Spec: docs/mcp-servers.md §3 — the four v1 servers with empty token
 * placeholders the user replaces. The `<resolved-at-first-launch>` arg for the
 * OmniFocus server is filled in by the writer (it depends on the install path).
 */

import type { McpServersFile } from '@shared/types';
import { PLACEHOLDER_TOKEN } from '@shared/constants';

/**
 * Build the default config. `omnifocusServerEntry` is the absolute path to the
 * compiled OmniFocus JXA MCP server (architecture.md §5.3), resolved at first
 * launch from the app's install location.
 */
export function buildDefaultConfig(omnifocusServerEntry: string): McpServersFile {
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
      omnifocus: {
        transport: 'stdio',
        command: 'node',
        args: [omnifocusServerEntry],
        env: {},
      },
    },
  };
}
