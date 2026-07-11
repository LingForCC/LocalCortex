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
import { SettingsRepository } from '../db/repositories/settings.js';
import { AgentsRepository } from '../db/repositories/agents.js';
import { TaskManagersRepository } from '../db/repositories/task-managers.js';
import { McpServersRepository } from '../db/repositories/mcp-servers.js';
import { registerHandoffSetupIpc } from './handoff-setup.js';
import { IPC, type HandoffSetupResult } from '@shared/schemas/ipc-schema';
import { HANDOFF_RULE_ID } from '../handoff-setup/setup-builder.js';
import type { DatabaseSync } from 'node:sqlite';

let db: DatabaseSync;
let rulesRepo: RulesRepository;
let settingsRepo: SettingsRepository;
let agentsRepo: AgentsRepository;
let taskManagersRepo: TaskManagersRepository;
let mcpServersRepo: McpServersRepository;
let onRulesChangedCalled: boolean;

async function invoke(channel: string, payload?: unknown): Promise<HandoffSetupResult> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return (await fn({}, payload)) as HandoffSetupResult;
}

beforeEach(() => {
  handlers.clear();
  db = openMemoryDatabase();
  runMigrations(db);
  rulesRepo = new RulesRepository(db);
  settingsRepo = new SettingsRepository(db);
  agentsRepo = new AgentsRepository(db);
  taskManagersRepo = new TaskManagersRepository(db);
  mcpServersRepo = new McpServersRepository(db);
  onRulesChangedCalled = false;
  registerHandoffSetupIpc({
    settingsRepo,
    agentsRepo,
    taskManagersRepo,
    rulesRepo,
    mcpServersRepo,
    onRulesChanged: () => {
      onRulesChangedCalled = true;
    },
  });
});

describe('handoff-setup:complete', () => {
  it('creates the rule and persists settings on valid input', async () => {
    const result = await invoke(IPC.HANDOFF_SETUP_COMPLETE, {
      agentId: 'zcode',
      taskManagerId: 'omnifocus',
      backend: 'claude',
    });
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();

    // The rule should exist.
    const rule = rulesRepo.get(HANDOFF_RULE_ID);
    expect(rule).not.toBeNull();
    expect(rule?.backend).toBe('claude');
    expect((rule?.trigger as { eventType: string }).eventType).toBe('zcode.session-complete');
    expect(rule?.mcpServers).toEqual(['omnifocus']);

    // Settings should be persisted.
    const s = settingsRepo.get();
    expect(s.handoffAgentId).toBe('zcode');
    expect(s.handoffTaskManagerId).toBe('omnifocus');
    expect(s.handoffBackend).toBe('claude');
    expect(s.handoffRuleId).toBe(HANDOFF_RULE_ID);
  });

  it('broadcasts onRulesChanged after setup', async () => {
    await invoke(IPC.HANDOFF_SETUP_COMPLETE, {
      agentId: 'zcode',
      taskManagerId: 'omnifocus',
      backend: 'codex',
    });
    expect(onRulesChangedCalled).toBe(true);
  });

  it('is idempotent: re-running setup updates the same rule, not a duplicate', async () => {
    await invoke(IPC.HANDOFF_SETUP_COMPLETE, {
      agentId: 'zcode',
      taskManagerId: 'omnifocus',
      backend: 'claude',
    });
    await invoke(IPC.HANDOFF_SETUP_COMPLETE, {
      agentId: 'codex',
      taskManagerId: 'omnifocus',
      backend: 'codex',
    });
    // Only one rule with the fixed id.
    expect(rulesRepo.get(HANDOFF_RULE_ID)).not.toBeNull();
    const allRules = rulesRepo.list();
    expect(allRules.filter((r) => r.id === HANDOFF_RULE_ID)).toHaveLength(1);

    // The rule reflects the latest choices.
    const rule = rulesRepo.get(HANDOFF_RULE_ID);
    expect((rule?.trigger as { eventType: string }).eventType).toBe('codex.session-complete');
    expect(rule?.backend).toBe('codex');
  });

  it('returns ok=false for an unknown agent id', async () => {
    const result = await invoke(IPC.HANDOFF_SETUP_COMPLETE, {
      agentId: 'nonexistent',
      taskManagerId: 'omnifocus',
      backend: 'claude',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unknown agent');
  });

  it('returns ok=false for an unknown task manager id', async () => {
    const result = await invoke(IPC.HANDOFF_SETUP_COMPLETE, {
      agentId: 'zcode',
      taskManagerId: 'nonexistent',
      backend: 'claude',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unknown task manager');
  });

  it('returns ok=false for an invalid payload (missing fields)', async () => {
    const result = await invoke(IPC.HANDOFF_SETUP_COMPLETE, { agentId: 'zcode' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid setup request');
  });
});

describe('handoff-setup:reset', () => {
  it('clears the handoff settings fields', async () => {
    // First, complete the setup.
    await invoke(IPC.HANDOFF_SETUP_COMPLETE, {
      agentId: 'zcode',
      taskManagerId: 'omnifocus',
      backend: 'claude',
    });
    expect(settingsRepo.get().handoffAgentId).toBe('zcode');

    // Then reset.
    const result = await invoke(IPC.HANDOFF_SETUP_RESET);
    expect(result.ok).toBe(true);

    const s = settingsRepo.get();
    expect(s.handoffAgentId).toBeUndefined();
    expect(s.handoffTaskManagerId).toBeUndefined();
    expect(s.handoffBackend).toBeUndefined();
    expect(s.handoffRuleId).toBeUndefined();
  });

  it('does not delete the rule on reset (user may keep it)', async () => {
    await invoke(IPC.HANDOFF_SETUP_COMPLETE, {
      agentId: 'zcode',
      taskManagerId: 'omnifocus',
      backend: 'claude',
    });
    await invoke(IPC.HANDOFF_SETUP_RESET);
    expect(rulesRepo.get(HANDOFF_RULE_ID)).not.toBeNull();
  });
});
