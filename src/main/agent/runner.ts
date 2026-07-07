/**
 * The AgentRunner abstraction — the single interface the rest of the app uses
 * to run an agent, regardless of backend (Claude or Codex).
 *
 * Spec: docs/architecture.md §4 (agent/), §5.5 (MCP config asymmetry between
 * backends). The difference between Claude (per-call `options.mcpServers` +
 * `options.cwd`) and Codex (per-run staged workdir + `.codex/config.toml`) is
 * invisible to callers — it lives in the two implementations.
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
   */
  run(input: RunInput): Promise<RunResult>;
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
