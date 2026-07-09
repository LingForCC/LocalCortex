/**
 * The shared per-run flow — the "everything from step 2 onward" path that both
 * tick and event triggers feed into.
 *
 * Spec: docs/architecture.md §7 (Per-run flow, end to end).
 *
 *  1. (dequeue happens in the concurrency queue — caller)
 *  2. Staging prepares the per-run workdir (Codex: writes .codex/config.toml).
 *  3. Resolve the rule's MCP servers from the user's mcp-servers.json.
 *  4. Prompt builder renders event vars + assembles rule + status contract.
 *  5. AgentRunner (Claude or Codex) runs the agent.
 *  6. Run recorder logs prompt, tool calls, tokens, result, parsed status.
 *  7. Stop check: disable the rule on done/error/maxRuns/expiresAt.
 *  8. MCP servers torn down, workdir cleaned up (Codex: security-critical).
 *
 * This module is the seam between pure logic and Electron. It depends on
 * repositories (DB) and the runner (SDK), but is constructed with those
 * dependencies so it's testable with fakes.
 */

import type { Rule, ResolvedMcpServers, IncomingEvent } from '@shared/types';
import type { RulesRepository } from '../db/repositories/rules.js';
import type { RunsRepository, NewRun } from '../db/repositories/runs.js';
import type { AgentRunner, RunEvent } from './runner.js';
import { buildPrompt } from './prompt-builder.js';
import { parseStatusBlock } from './status-parser.js';
import { evaluateStop } from './stop-check.js';
import { recordRun } from '../observability/run-recorder.js';
import { logger } from '../observability/logger.js';
import { resolveMcpServers } from '../mcp/resolver.js';
import { stageRun } from './staging.js';
import type { McpServersFile } from '@shared/types';

/** How a backend is selected for a run. */
export type RunnerProvider = (backend: Rule['backend']) => AgentRunner;

export interface RunLoopDeps {
  rulesRepo: RulesRepository;
  runsRepo: RunsRepository;
  /** The user's parsed mcp-servers.json (reloaded per run is fine). */
  mcpConfig: McpServersFile;
  /** Returns the AgentRunner for a given backend. */
  runnerProvider: RunnerProvider;
  /** App data root (e.g. ~/.localcortex), used for staged workdirs. */
  appDataRoot: string;
  /** How this run was triggered. */
  trigger: 'tick' | 'event' | 'manual';
  /** Override now() for deterministic tests. */
  now?: () => Date;
}

export interface RunRequest {
  ruleId: string;
  /** Event-triggered runs carry the event payload (for template render). */
  event?: IncomingEvent;
}

/**
 * Execute one agent run end-to-end. Returns the recorded run id.
 *
 * Never throws for agent-side failures (they're recorded as an error run);
 * throws only for setup problems (missing rule, undefined MCP server) that
 * prevent the run from starting.
 */
export async function executeRun(deps: RunLoopDeps, req: RunRequest): Promise<number> {
  const { rulesRepo, runsRepo, mcpConfig, runnerProvider, appDataRoot, trigger } = deps;
  const now = deps.now ?? (() => new Date());

  const rule = rulesRepo.get(req.ruleId);
  if (!rule) throw new Error(`executeRun: rule '${req.ruleId}' not found`);

  const runner = runnerProvider(rule.backend);
  const startedAt = now().toISOString();
  const startMs = Date.now();

  // Increment the run counter up-front (used by the maxRuns backstop).
  const runCount = rulesRepo.incrementRunCount(rule.id) ?? rule.runCount + 1;

  // 3. Resolve MCP servers from the user's config.
  const servers: ResolvedMcpServers = resolveMcpServers(
    { id: rule.id, mcpServers: rule.mcpServers },
    mcpConfig,
  );

  // 4. Build the prompt (render event vars for event-triggered runs).
  const prompt = buildPrompt({
    rule,
    servers,
    eventPayload: req.event?.payload,
  });

  // 2. Stage the workdir. Both backends use the same path: resolve the cwd
  //    (honoring rule.workdir, falling back to a per-rule scratch dir) and
  //    ensure it exists. MCP config is per-call now, so staging writes nothing.
  const staged = stageRun(rule, appDataRoot);
  const cwd = staged.cwd;

  /** Apply the stop-condition decision after a run (shared by success + error paths). */
  const applyStopCheck = (parsedStatus: ReturnType<typeof parseStatusBlock>): void => {
    const decision = evaluateStop({
      parsedStatus,
      runCount,
      maxRuns: rule.maxRuns,
      expiresAt: rule.expiresAt,
      // Stop policy keys off the rule's trigger type (not the run-level trigger)
      // so that a manual run of an event rule still gets the event-rule policy:
      // event rules run as long as enabled, regardless of run outcome.
      trigger: rule.trigger.type,
      // settings carries no global maxRuns override today; evaluateStop falls
      // back to the built-in DEFAULT_MAX_RUNS for rules that don't set one.
      now,
    });
    if (decision.shouldDisable && decision.reason) {
      rulesRepo.setEnabled(rule.id, false, decision.reason);
    }
  };

  /**
   * Live progress sink handed to the runner. Each intermediate event the agent
   * emits is surfaced to the file log so an operator can watch a slow run
   * progress (and see exactly when/where it stalls) rather than staring at
   * silence until completion. Kept deliberately terse — one line per event.
   */
  const logEvent = (event: RunEvent): void => {
    if (event.type === 'tool_call') {
      logger.info(
        `run rule=${rule.id} tool_call ${event.tool}` +
          (event.args != null ? ` args=${JSON.stringify(event.args).slice(0, 120)}` : ''),
      );
    } else if (event.type === 'tool_result') {
      logger.info(
        `run rule=${rule.id} tool_result ${event.tool} ${event.ok ? 'ok' : 'FAILED'}` +
          (event.error ? ` error=${event.error}` : ''),
      );
    } else {
      // assistant_text — truncate to keep the log scannable; the full text lands
      // in the run record's `result` column at completion.
      logger.info(`run rule=${rule.id} text: ${event.text.slice(0, 160)}`);
    }
  };

  let runId: number;
  try {
    // 5. Run the agent.
    const result = await runner.run(
      {
        prompt,
        workdir: cwd,
        sandbox: rule.sandbox,
        servers,
      },
      logEvent,
    );

    const endedAt = now().toISOString();
    const durationMs = Date.now() - startMs;

    // 6. Parse status + record.
    const parsedStatus = parseStatusBlock(result.text);
    const isError = result.isError || parsedStatus?.status === 'error';
    const newRun: NewRun = {
      ruleId: rule.id,
      trigger,
      startedAt,
      endedAt,
      status: isError ? 'error' : 'success',
      prompt,
      toolCalls: result.toolCalls,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs,
      result: result.text,
      parsedStatus: parsedStatus ?? undefined,
      error: result.error,
      eventPayload: req.event?.payload,
    };
    // Record via the run-recorder so the run is both persisted AND surfaced as
    // a one-line summary in the file log (docs/features/observability §"Logging").
    runId = recordRun(runsRepo, newRun);

    // 7. Stop check.
    applyStopCheck(parsedStatus);
  } catch (e) {
    // The agent run itself failed (e.g. missing API key, SDK error). This is a
    // post-staging failure: we have a prompt and a staged workdir, so — per
    // architecture.md §7 step 6 ("every run is recorded") — record it as an
    // error run rather than letting it vanish. Observability is the safety net
    // under auto-execute; an unrecorded failure would be invisible to the
    // operator. Pre-staging failures (missing rule, undefined MCP server) still
    // throw from above, before there is anything meaningful to record.
    const durationMs = Date.now() - startMs;
    const message = e instanceof Error ? e.message : String(e);
    runId = recordRun(runsRepo, {
      ruleId: rule.id,
      trigger,
      startedAt,
      endedAt: now().toISOString(),
      status: 'error',
      prompt,
      toolCalls: [],
      durationMs,
      error: message,
      eventPayload: req.event?.payload,
    });
    applyStopCheck(null);
  } finally {
    // 8. Teardown — no-op today (staging writes nothing to disk now that MCP
    //    config is passed per-call). Kept for symmetry / future use.
    staged.cleanup();
  }

  return runId;
}
