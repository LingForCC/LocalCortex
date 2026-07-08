/**
 * The AgentRunner abstraction — the single interface the rest of the app uses
 * to run an agent, regardless of backend (Claude or Codex).
 *
 * Spec: docs/architecture.md §4 (agent/), §5.5 (MCP config delivery between
 * backends). Both backends take MCP config per-call — Claude via
 * `options.mcpServers`, Codex via the SDK `config` option (flattened to
 * `--config key=value` CLI flags). The difference is invisible to callers —
 * it lives in the two implementations.
 *
 * This module owns ONLY the interface + shared types. The runners themselves
 * (claude.ts, codex.ts) import the SDKs; this file stays SDK-free so anything
 * that depends on the interface doesn't transitively import the SDKs.
 */

import type { ResolvedMcpServers } from '@shared/types';

/** Inputs every runner needs to execute one run. */
export interface RunInput {
  /** Fully-assembled prompt (rule text rendered + status contract + tool list). */
  prompt: string;
  /** Working directory the agent runs in (architecture.md §6.1). */
  workdir: string;
  /** Sandbox blast-radius mode (architecture.md §6.2). */
  sandbox: 'read-only' | 'workspace-write';
  /** Resolved MCP servers to attach to this run. */
  servers: ResolvedMcpServers;
  /** Optional abort signal (set on app-quit / run cancel). */
  signal?: AbortSignal;
  /** Optional upper bound on agent turns/iterations (safety). */
  maxTurns?: number;
}

/** A tool call observed during the run (best-effort capture for observability). */
export interface ObservedToolCall {
  tool: string;
  args?: unknown;
  result?: unknown;
}

/**
 * Intermediate progress events emitted *during* a run, before `run()` resolves.
 * Backend-agnostic and SDK-free: each runner normalizes its own event stream into
 * these shapes. Consumed by the run-loop for live logging (and, later, for the
 * "active run" UI). Deliberately coarse — `tool_call` fires when a tool is
 * invoked, `tool_result` when it returns, `assistant_text` for assistant output.
 * Backends that surface only a subset simply omit the others (e.g. neither
 * backend reports a `result` payload here today).
 */
export type RunEvent =
  | { type: 'tool_call'; tool: string; args?: unknown }
  | { type: 'tool_result'; tool: string; ok: boolean; error?: string }
  | { type: 'assistant_text'; text: string };

/**
 * Optional progress sink handed to `AgentRunner.run`. Runners that can stream
 * intermediate events call this as they occur; runners that can't simply ignore
 * it. Kept optional so existing callers/tests keep working unchanged.
 */
export type RunEventCallback = (event: RunEvent) => void;

/** The outcome of a run, normalized across backends. */
export interface RunResult {
  /** The agent's final text response. */
  text: string;
  /** Tool calls observed during the run. */
  toolCalls: ObservedToolCall[];
  /** Token usage, if the SDK reports it. */
  inputTokens?: number;
  outputTokens?: number;
  /** Whether the SDK/backend reported a non-recoverable error. */
  isError: boolean;
  /** A short error message when isError is true. */
  error?: string;
}

/**
 * Backend-agnostic agent runner. Implementations:
 *  - ClaudeAgentRunner (agent/claude.ts)
 *  - CodexAgentRunner (agent/codex.ts)
 */
export interface AgentRunner {
  /** Human-readable backend id ('claude' | 'codex'). */
  readonly backend: 'claude' | 'codex';

  /**
   * Execute one run. Resolves with the normalized result.
   * Implementations are responsible for:
   *  - spawning/attaching MCP servers per `servers`;
   *  - setting the workdir + sandbox per `workdir`/`sandbox`;
   *  - auto-execute (no pre-write approval) — arch §6.3;
   *  - tearing down any per-run resources (workdir staging teardown happens
   *    outside the runner, in staging.ts/run-loop.ts).
   *
   * `onEvent`, if provided, receives intermediate progress events during the
   * run (tool calls/results, assistant text) so callers can surface live
   * progress before the run resolves. Optional and best-effort — runners that
   * cannot stream simply never call it.
   */
  run(input: RunInput, onEvent?: RunEventCallback): Promise<RunResult>;
}

/** Thrown when an AgentRunner fails to even start a run (before any agent output). */
export class AgentRunError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AgentRunError';
  }
}
