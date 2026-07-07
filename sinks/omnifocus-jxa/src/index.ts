/**
 * OmniFocus JXA MCP server entry point.
 *
 * Spec: docs/architecture.md §5.3. A minimal MCP server with three tools:
 *   - create_task  — create a task with name, note, and project
 *   - update_task  — modify an existing task
 *   - close_task   — mark a task complete
 *   - find_tasks   — look up tasks by id or name substring (convenience read)
 *
 * Uses JXA (JavaScript for Automation) rather than AppleScript strings:
 * Omni's official scripting API, less escaping fragility, callable from Node
 * via `osascript -l JavaScript`. Runs as a stdio MCP child process spawned per
 * agent run by LocalCortex (architecture.md §5.2, §5.4).
 */

import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(__dirname, 'scripts');

const SERVER_NAME = 'omnifocus-jxa';
const SERVER_VERSION = '0.1.0';

/** Run a JXA script with a single JSON-string argv, returning parsed JSON. */
function runJxa(scriptName: string, args: Record<string, unknown>): Promise<unknown> {
  const scriptPath = join(SCRIPTS_DIR, `${scriptName}.scpt`);
  return new Promise((resolve, reject) => {
    execFile(
      'osascript',
      ['-l', 'JavaScript', scriptPath, JSON.stringify(args)],
      { maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`osascript ${scriptName} failed: ${err.message} ${stderr}`));
          return;
        }
        const text = stdout.trim();
        if (!text) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch {
          // Script may print plain text on non-JSON paths; return it raw.
          resolve({ raw: text });
        }
      },
    );
  });
}

async function main(): Promise<void> {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  // --- ListTools -----------------------------------------------------------
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'create_task',
        description: 'Create a task in OmniFocus with a name, optional note, and optional project.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Task title.' },
            note: { type: 'string', description: 'Task note (optional).' },
            project: {
              type: 'string',
              description: 'Target project name; omitted → Inbox.',
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'update_task',
        description: 'Update an existing OmniFocus task by id (name, note, and/or project).',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The OmniFocus task id.' },
            name: { type: 'string' },
            note: { type: 'string' },
            project: { type: 'string', description: 'Move to this project.' },
          },
          required: ['id'],
        },
      },
      {
        name: 'close_task',
        description: 'Mark an OmniFocus task complete by id.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The OmniFocus task id.' },
          },
          required: ['id'],
        },
      },
      {
        name: 'find_tasks',
        description: 'Find OmniFocus tasks by name substring or id.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Substring to match against task names.' },
            id: { type: 'string', description: 'Exact id to look up.' },
          },
        },
      },
    ],
  }));

  // --- CallTool ------------------------------------------------------------
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    let result: unknown;
    try {
      switch (name) {
        case 'create_task':
          result = await runJxa('create', args);
          break;
        case 'update_task':
          result = await runJxa('update', args);
          break;
        case 'close_task':
          result = await runJxa('close', args);
          break;
        case 'find_tasks':
          result = await runJxa('find', args);
          break;
        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (e) {
      return {
        content: [{ type: 'text', text: (e as Error).message }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error(`${SERVER_NAME} failed to start:`, e);
  process.exit(1);
});
