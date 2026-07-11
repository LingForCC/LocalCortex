/**
 * IPC handlers for the catalog CRUD channels: `agents:*`, `task-managers:*`,
 * and `mcp-servers:*`.
 *
 * Spec: docs/features/handoff-setup/README.md, docs/features/mcp-sources/README.md.
 *
 * Each handler validates its payload with a Zod schema before acting (the
 * standard pattern, see src/main/ipc/rules.ts). These channels are the
 * zero-code extensibility path: a custom agent/task-manager/server is a `create`
 * IPC call from an in-app form — no recompile.
 */

import { ipcMain } from 'electron';
import { IPC, IdSchema, NameSchema } from '@shared/schemas/ipc-schema';
import { AgentInputSchema } from '@shared/schemas/agent-schema';
import { TaskManagerInputSchema } from '@shared/schemas/task-manager-schema';
import { McpServerInputSchema } from '@shared/schemas/mcp-server-schema';
import type { AgentsRepository } from '../db/repositories/agents.js';
import type { TaskManagersRepository } from '../db/repositories/task-managers.js';
import type { McpServersRepository } from '../db/repositories/mcp-servers.js';

export interface CatalogIpcDeps {
  agentsRepo: AgentsRepository;
  taskManagersRepo: TaskManagersRepository;
  mcpServersRepo: McpServersRepository;
}

export function registerCatalogIpc(deps: CatalogIpcDeps): void {
  // --- Agents ---------------------------------------------------------------
  ipcMain.handle(IPC.AGENTS_LIST, async () => deps.agentsRepo.list());
  ipcMain.handle(IPC.AGENTS_GET, async (_evt, raw) => {
    const { id } = IdSchema.parse(raw);
    return deps.agentsRepo.get(id);
  });
  ipcMain.handle(IPC.AGENTS_CREATE, async (_evt, raw) => {
    const input = AgentInputSchema.parse(raw);
    deps.agentsRepo.create(input);
    return deps.agentsRepo.get(input.id);
  });
  ipcMain.handle(IPC.AGENTS_UPDATE, async (_evt, raw) => {
    const input = AgentInputSchema.parse(raw);
    deps.agentsRepo.update(input);
    return deps.agentsRepo.get(input.id);
  });
  ipcMain.handle(IPC.AGENTS_DELETE, async (_evt, raw) => {
    const { id } = IdSchema.parse(raw);
    return deps.agentsRepo.delete(id);
  });

  // --- Task managers --------------------------------------------------------
  ipcMain.handle(IPC.TASK_MANAGERS_LIST, async () => deps.taskManagersRepo.list());
  ipcMain.handle(IPC.TASK_MANAGERS_GET, async (_evt, raw) => {
    const { id } = IdSchema.parse(raw);
    return deps.taskManagersRepo.get(id);
  });
  ipcMain.handle(IPC.TASK_MANAGERS_CREATE, async (_evt, raw) => {
    const input = TaskManagerInputSchema.parse(raw);
    deps.taskManagersRepo.create(input);
    return deps.taskManagersRepo.get(input.id);
  });
  ipcMain.handle(IPC.TASK_MANAGERS_UPDATE, async (_evt, raw) => {
    const input = TaskManagerInputSchema.parse(raw);
    deps.taskManagersRepo.update(input);
    return deps.taskManagersRepo.get(input.id);
  });
  ipcMain.handle(IPC.TASK_MANAGERS_DELETE, async (_evt, raw) => {
    const { id } = IdSchema.parse(raw);
    return deps.taskManagersRepo.delete(id);
  });

  // --- MCP servers ----------------------------------------------------------
  ipcMain.handle(IPC.MCP_SERVERS_LIST, async () => deps.mcpServersRepo.list());
  ipcMain.handle(IPC.MCP_SERVERS_GET, async (_evt, raw) => {
    const { name } = NameSchema.parse(raw);
    return deps.mcpServersRepo.getByName(name);
  });
  ipcMain.handle(IPC.MCP_SERVERS_UPSERT, async (_evt, raw) => {
    const input = McpServerInputSchema.parse(raw);
    return deps.mcpServersRepo.upsert(input);
  });
  ipcMain.handle(IPC.MCP_SERVERS_DELETE, async (_evt, raw) => {
    const { name } = NameSchema.parse(raw);
    return deps.mcpServersRepo.delete(name);
  });
}
