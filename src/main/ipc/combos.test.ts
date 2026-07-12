import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock `electron` so ipcMain.handle can be captured without a running app.
type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, IpcHandler>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: IpcHandler) => {
      handlers.set(channel, fn);
    },
  },
}));

import { openMemoryDatabase } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { RulesRepository } from '../db/repositories/rules.js';
import { CombosRepository } from '../db/repositories/combos.js';
import { AgentsRepository } from '../db/repositories/agents.js';
import { TaskManagersRepository } from '../db/repositories/task-managers.js';
import { McpServersRepository } from '../db/repositories/mcp-servers.js';
import { registerCombosIpc } from './combos.js';
import { IPC } from '@shared/schemas/ipc-schema';
import type { Combo } from '@shared/types';
import type { DatabaseSync } from 'node:sqlite';

let db: DatabaseSync;
let rulesRepo: RulesRepository;
let combosRepo: CombosRepository;
let agentsRepo: AgentsRepository;
let taskManagersRepo: TaskManagersRepository;
let mcpServersRepo: McpServersRepository;
let onRulesChangedCalled: boolean;

async function invoke(channel: string, payload?: unknown): Promise<unknown> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return fn({}, payload);
}

beforeEach(() => {
  handlers.clear();
  db = openMemoryDatabase();
  runMigrations(db);
  rulesRepo = new RulesRepository(db);
  combosRepo = new CombosRepository(db);
  agentsRepo = new AgentsRepository(db);
  taskManagersRepo = new TaskManagersRepository(db);
  mcpServersRepo = new McpServersRepository(db);
  onRulesChangedCalled = false;
  registerCombosIpc({
    combosRepo,
    agentsRepo,
    taskManagersRepo,
    rulesRepo,
    mcpServersRepo,
    onRulesChanged: () => {
      onRulesChangedCalled = true;
    },
  });
});

describe('combos:create', () => {
  it('creates a rule + combo on valid input and broadcasts onRulesChanged', async () => {
    const result = (await invoke(IPC.COMBOS_CREATE, {
      label: 'ZCode → OmniFocus',
      agentId: 'zcode',
      taskManagerId: 'omnifocus',
      backend: 'claude',
    })) as { ok: boolean; combo: Combo };
    expect(result.ok).toBe(true);
    expect(result.combo.agentId).toBe('zcode');
    expect(result.combo.taskManagerId).toBe('omnifocus');
    expect(result.combo.backend).toBe('claude');
    expect(result.combo.enabled).toBe(true);
    expect(onRulesChangedCalled).toBe(true);

    // The owned rule exists with the right event type / servers / backend.
    const rule = rulesRepo.get(result.combo.ruleId);
    expect(rule).not.toBeNull();
    expect((rule?.trigger as { eventType: string }).eventType).toBe('zcode.session-complete');
    expect(rule?.mcpServers).toEqual(['omnifocus']);
    expect(rule?.backend).toBe('claude');
    expect(rule?.name).toBe('ZCode → OmniFocus');
  });

  it('returns ok=false for an unknown agent', async () => {
    const result = (await invoke(IPC.COMBOS_CREATE, {
      label: 'x',
      agentId: 'ghost',
      taskManagerId: 'omnifocus',
      backend: 'claude',
    })) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unknown agent');
  });

  it('returns ok=false for an unknown task manager', async () => {
    const result = (await invoke(IPC.COMBOS_CREATE, {
      label: 'x',
      agentId: 'zcode',
      taskManagerId: 'ghost',
      backend: 'claude',
    })) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unknown task manager');
  });

  it('returns ok=false when the task manager MCP server is missing', async () => {
    // Create a throwaway MCP server + task manager, then delete the server so
    // the task manager row references a now-missing server. We can't re-point
    // an existing task manager (FK RESTRICT), so delete the server instead.
    db.prepare(
      `INSERT INTO mcp_servers (name, transport, command, args_json, env_json, is_builtin)
       VALUES ('temp-server', 'stdio', 'npx', '[]', '{}', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO task_managers (id, label, description, mcp_server_name, requires_token,
                                   token_env_var, setup_instructions, is_builtin)
       VALUES ('temp-tm', 'Temp', 'd', 'temp-server', 0, NULL, 's', 0)`,
    ).run();
    // Now remove the server, leaving temp_tm dangling. task_managers has an ON
    // DELETE RESTRICT FK on mcp_server_name; wrap in a transaction with deferred
    // FKs to simulate the dangling-reference state within this test.
    db.exec(`PRAGMA foreign_keys = OFF`);
    db.prepare(`DELETE FROM mcp_servers WHERE name = 'temp-server'`).run();
    db.exec(`PRAGMA foreign_keys = ON`);
    const result = (await invoke(IPC.COMBOS_CREATE, {
      label: 'x',
      agentId: 'zcode',
      taskManagerId: 'temp-tm',
      backend: 'claude',
    })) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain('missing MCP server');
  });

  it('supports creating multiple combos (multi-combo model)', async () => {
    const r1 = (await invoke(IPC.COMBOS_CREATE, {
      label: 'ZCode',
      agentId: 'zcode',
      taskManagerId: 'omnifocus',
      backend: 'claude',
    })) as { ok: boolean; combo: Combo };
    const r2 = (await invoke(IPC.COMBOS_CREATE, {
      label: 'Codex',
      agentId: 'codex',
      taskManagerId: 'omnifocus',
      backend: 'codex',
    })) as { ok: boolean; combo: Combo };
    expect(r1.ok && r2.ok).toBe(true);
    expect(r1.combo.id).not.toBe(r2.combo.id);
    expect(r1.combo.ruleId).not.toBe(r2.combo.ruleId);
    // Two distinct rules with two distinct event types.
    expect((rulesRepo.get(r1.combo.ruleId)?.trigger as { eventType: string }).eventType).toBe(
      'zcode.session-complete',
    );
    expect((rulesRepo.get(r2.combo.ruleId)?.trigger as { eventType: string }).eventType).toBe(
      'codex.session-complete',
    );
  });
});

describe('combos:update', () => {
  it('patches combo-owned fields and preserves user prompt/model edits', async () => {
    const created = (await invoke(IPC.COMBOS_CREATE, {
      label: 'ZCode → OmniFocus',
      agentId: 'zcode',
      taskManagerId: 'omnifocus',
      backend: 'claude',
    })) as { ok: boolean; combo: Combo };
    const combo = created.combo;

    // Simulate the user editing the rule's prompt + model via the Rules tab.
    const ruleRow = rulesRepo.get(combo.ruleId)!;
    rulesRepo.update({ ...ruleRow, rule: 'CUSTOM PROMPT', model: 'gpt-5' });

    // Now update the combo to switch agent + backend.
    const result = (await invoke(IPC.COMBOS_UPDATE, {
      id: combo.id,
      payload: {
        label: 'Codex → OmniFocus',
        agentId: 'codex',
        taskManagerId: 'omnifocus',
        backend: 'codex',
      },
    })) as { ok: boolean; combo: Combo };
    expect(result.ok).toBe(true);
    expect(result.combo.agentId).toBe('codex');
    expect(result.combo.backend).toBe('codex');
    expect(result.combo.label).toBe('Codex → OmniFocus');

    const rule = rulesRepo.get(combo.ruleId)!;
    expect((rule.trigger as { eventType: string }).eventType).toBe('codex.session-complete');
    expect(rule.backend).toBe('codex');
    expect(rule.name).toBe('Codex → OmniFocus');
    // User edits preserved.
    expect(rule.rule).toBe('CUSTOM PROMPT');
    expect(rule.model).toBe('gpt-5');
  });

  it('returns ok=false for a missing combo', async () => {
    const result = (await invoke(IPC.COMBOS_UPDATE, {
      id: 'nonexistent',
      payload: { label: 'x', agentId: 'zcode', taskManagerId: 'omnifocus', backend: 'claude' },
    })) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found');
  });
});

describe('combos:setEnabled', () => {
  it('mirrors the flag onto the owned rule', async () => {
    const created = (await invoke(IPC.COMBOS_CREATE, {
      label: 'Z',
      agentId: 'zcode',
      taskManagerId: 'omnifocus',
      backend: 'claude',
    })) as { ok: boolean; combo: Combo };
    const combo = created.combo;
    expect(rulesRepo.get(combo.ruleId)?.enabled).toBe(true);

    const result = (await invoke(IPC.COMBOS_SET_ENABLED, {
      id: combo.id,
      enabled: false,
    })) as { ok: boolean; combo: Combo };
    expect(result.ok).toBe(true);
    expect(result.combo.enabled).toBe(false);
    // Rule mirrored.
    expect(rulesRepo.get(combo.ruleId)?.enabled).toBe(false);
  });
});

describe('combos:delete', () => {
  it('deletes both the combo and its owned rule', async () => {
    const created = (await invoke(IPC.COMBOS_CREATE, {
      label: 'Z',
      agentId: 'zcode',
      taskManagerId: 'omnifocus',
      backend: 'claude',
    })) as { ok: boolean; combo: Combo };
    const combo = created.combo;
    const ruleId = combo.ruleId;

    const result = (await invoke(IPC.COMBOS_DELETE, { id: combo.id })) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(combosRepo.get(combo.id)).toBeNull();
    expect(rulesRepo.get(ruleId)).toBeNull();
  });
});

describe('combos:list / combos:get', () => {
  it('lists and gets combos', async () => {
    const created = (await invoke(IPC.COMBOS_CREATE, {
      label: 'Z',
      agentId: 'zcode',
      taskManagerId: 'omnifocus',
      backend: 'claude',
    })) as { ok: boolean; combo: Combo };
    const list = (await invoke(IPC.COMBOS_LIST)) as Combo[];
    expect(list).toHaveLength(1);
    const got = (await invoke(IPC.COMBOS_GET, { id: created.combo.id })) as Combo | null;
    expect(got?.id).toBe(created.combo.id);
  });
});
