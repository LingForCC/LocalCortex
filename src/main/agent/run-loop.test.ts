/**
 * Tests for the run-loop orchestration. Uses in-memory DB + a stub AgentRunner
 * so the full enqueue→stage→resolve→prompt→run→record→stop-check path is
 * exercised without any SDK or Electron.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openMemoryDatabase } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { RulesRepository } from '../db/repositories/rules.js';
import { RunsRepository } from '../db/repositories/runs.js';
import { executeRun } from './run-loop.js';
import type { AgentRunner, RunInput, RunResult, RunEventCallback } from './runner.js';
import { logger } from '../observability/logger.js';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { McpServersFile, Rule } from '@shared/types';

let db: DatabaseSync;
let appData: string;
beforeEach(() => {
  db = openMemoryDatabase();
  runMigrations(db);
  appData = mkdtempSync(join(tmpdir(), 'lc-runloop-'));
});

/** Build a stub runner that returns a canned transcript. */
function stubRunner(resultText: string): AgentRunner {
  return {
    backend: 'claude',
    async run(_input: RunInput): Promise<RunResult> {
      return { text: resultText, toolCalls: [], isError: false };
    },
  };
}

const mcpConfig: McpServersFile = {
  servers: {
    omnifocus: {
      transport: 'stdio',
      command: 'node',
      args: ['x.js'],
      env: { FOO: 'bar' }, // real token, not a placeholder
    },
  },
};

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'r1',
    name: 'R1',
    enabled: true,
    rule: 'Do the thing.',
    trigger: { type: 'event', eventType: 'codex.session-complete' },
    mcpServers: ['omnifocus'],
    backend: 'claude',
    sandbox: 'read-only',
    ...overrides,
  };
}

describe('executeRun', () => {
  it('records a successful run and parses the status block', async () => {
    const rulesRepo = new RulesRepository(db);
    const runsRepo = new RunsRepository(db);
    rulesRepo.create(makeRule());

    const runId = await executeRun(
      {
        rulesRepo,
        runsRepo,
        mcpConfig,
        runnerProvider: () => stubRunner('Done.\n{"status":"done","reason":"merged"}'),
        appDataRoot: appData,
        trigger: 'event',
      },
      { ruleId: 'r1' },
    );

    const run = runsRepo.get(runId);
    expect(run?.status).toBe('success');
    expect(run?.parsedStatus).toEqual({ status: 'done', reason: 'merged' });
    expect(run?.prompt).toContain('STATUS CONTRACT');
  });

  it('disables the rule when the agent signals done', async () => {
    const rulesRepo = new RulesRepository(db);
    const runsRepo = new RunsRepository(db);
    rulesRepo.create(makeRule());

    await executeRun(
      {
        rulesRepo,
        runsRepo,
        mcpConfig,
        runnerProvider: () => stubRunner('{"status":"done"}'),
        appDataRoot: appData,
        trigger: 'tick',
      },
      { ruleId: 'r1' },
    );

    expect(rulesRepo.get('r1')?.enabled).toBe(false);
    expect(rulesRepo.get('r1')?.disableReason).toContain('agent signaled done');
  });

  it('keeps the rule enabled when the agent signals active', async () => {
    const rulesRepo = new RulesRepository(db);
    rulesRepo.create(makeRule());

    await executeRun(
      {
        rulesRepo,
        runsRepo: new RunsRepository(db),
        mcpConfig,
        runnerProvider: () => stubRunner('{"status":"active"}'),
        appDataRoot: appData,
        trigger: 'tick',
      },
      { ruleId: 'r1' },
    );
    expect(rulesRepo.get('r1')?.enabled).toBe(true);
  });

  it('renders event template variables into the prompt', async () => {
    const rulesRepo = new RulesRepository(db);
    const runsRepo = new RunsRepository(db);
    rulesRepo.create(makeRule({ rule: 'Session in {{workdir}} with: {{summary}}' }));

    const runId = await executeRun(
      {
        rulesRepo,
        runsRepo,
        mcpConfig,
        runnerProvider: () => stubRunner('{"status":"active"}'),
        appDataRoot: appData,
        trigger: 'event',
      },
      {
        ruleId: 'r1',
        event: {
          type: 'codex.session-complete',
          timestamp: '2026-07-07T00:00:00Z',
          payload: { workdir: '/code/app', summary: 'refactored auth' },
        },
      },
    );

    const run = runsRepo.get(runId);
    expect(run?.prompt).toContain('Session in /code/app with: refactored auth');
    expect(run?.eventPayload).toContain('/code/app');
  });

  it('deletes the staged Codex workdir after the run (token cleanup)', async () => {
    const rulesRepo = new RulesRepository(db);
    const runsRepo = new RunsRepository(db);
    rulesRepo.create(makeRule({ backend: 'codex' }));

    const codexRunner: AgentRunner = {
      backend: 'codex',
      async run(input: RunInput) {
        // The .codex/config.toml must exist during the run.
        const toml = readFileSync(join(input.workdir, '.codex', 'config.toml'), 'utf8');
        expect(toml).toContain('approval_policy = "never"');
        expect(toml).toContain('FOO = "bar"');
        return { text: '{"status":"done"}', toolCalls: [], isError: false };
      },
    };

    await executeRun(
      {
        rulesRepo,
        runsRepo,
        mcpConfig,
        runnerProvider: () => codexRunner,
        appDataRoot: appData,
        trigger: 'tick',
      },
      { ruleId: 'r1' },
    );

    // After teardown, the per-run workdir (containing the token-bearing config)
    // must be gone.
    const { readdirSync } = await import('node:fs');
    const runsDir = join(appData, 'r1');
    expect(readdirSync(runsDir)).toEqual([]); // timestamp subdir deleted
  });

  it('throws when the rule references an undefined MCP server', async () => {
    const rulesRepo = new RulesRepository(db);
    rulesRepo.create(makeRule({ mcpServers: ['nope'] }));

    await expect(
      executeRun(
        {
          rulesRepo,
          runsRepo: new RunsRepository(db),
          mcpConfig,
          runnerProvider: () => stubRunner(''),
          appDataRoot: appData,
          trigger: 'tick',
        },
        { ruleId: 'r1' },
      ),
    ).rejects.toThrow(/nope/);
  });

  it('records an error run (instead of throwing) when the runner fails post-staging', async () => {
    // Matches the executeRun contract: setup problems throw, but an agent-side
    // failure (e.g. missing API key) is recorded as an error run so it shows up
    // in Run history — the safety net under auto-execute. See JSDoc on executeRun.
    const rulesRepo = new RulesRepository(db);
    const runsRepo = new RunsRepository(db);
    rulesRepo.create(makeRule());

    const failingRunner: AgentRunner = {
      backend: 'claude',
      async run(): Promise<RunResult> {
        throw new Error('Claude agent run failed: ANTHROPIC_API_KEY not set');
      },
    };

    const runId = await executeRun(
      {
        rulesRepo,
        runsRepo,
        mcpConfig,
        runnerProvider: () => failingRunner,
        appDataRoot: appData,
        trigger: 'manual',
      },
      { ruleId: 'r1' },
    );

    const run = runsRepo.get(runId);
    expect(run).not.toBeNull();
    expect(run?.status).toBe('error');
    expect(run?.error).toMatch(/ANTHROPIC_API_KEY/);
    expect(run?.prompt).toContain('STATUS CONTRACT');
    expect(run?.toolCalls).toEqual([]);
    // durationMs is recorded and non-negative (observability test-plan O-L gap).
    expect(run?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('forwards intermediate progress events from the runner to the log', async () => {
    // The run-loop hands the runner an onEvent callback that logs each event
    // (tool_call / tool_result / assistant_text). A runner that emits events
    // should produce matching log lines — this is the live-progress signal an
    // operator tails during a slow run.
    const rulesRepo = new RulesRepository(db);
    const runsRepo = new RunsRepository(db);
    rulesRepo.create(makeRule());

    const emittingRunner: AgentRunner = {
      backend: 'claude',
      async run(_input: RunInput, onEvent?: RunEventCallback): Promise<RunResult> {
        onEvent?.({ type: 'tool_call', tool: 'mcp__omnifocus__create_task', args: { title: 'X' } });
        onEvent?.({ type: 'tool_result', tool: 'mcp__omnifocus__create_task', ok: true });
        onEvent?.({ type: 'assistant_text', text: 'Created the task.' });
        return { text: '{"status":"active"}', toolCalls: [], isError: false };
      },
    };

    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => logger);

    await executeRun(
      {
        rulesRepo,
        runsRepo,
        mcpConfig,
        runnerProvider: () => emittingRunner,
        appDataRoot: appData,
        trigger: 'manual',
      },
      { ruleId: 'r1' },
    );

    // Each event type produced one log line, tagged with the rule id.
    const lines = infoSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('tool_call mcp__omnifocus__create_task'))).toBe(true);
    expect(lines.some((l) => l.includes('tool_result mcp__omnifocus__create_task ok'))).toBe(true);
    expect(lines.some((l) => l.includes('text: Created the task.'))).toBe(true);

    infoSpy.mockRestore();
  });
});

afterEach(() => {
  rmSync(appData, { recursive: true, force: true });
});
