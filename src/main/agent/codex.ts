/**
 * Codex SDK runner.
 *
 * Spec: docs/architecture.md §5.5, §6.1-§6.3; docs/mcp-servers.md §5.2.
 *
 * Codex differs from Claude (architecture.md §5.5):
 *  - MCP config comes from `.codex/config.toml` in the workdir, NOT a per-call
 *    param. The staging module (staging.ts) writes that file before the runner
 *    is invoked; this runner expects it to exist in `input.workdir`.
 *  - `approval_policy = "never"` lives in the same config.toml (auto-execute).
 *  - Workdir + sandbox are set via ThreadOptions.
 *
 * The runner is otherwise symmetric with Claude: normalize the result (text,
 * tool calls, tokens) into RunResult.
 */

import {
  Codex,
  type CodexOptions,
  type Thread,
  type ThreadItem,
  type Input,
} from '@openai/codex-sdk';
import type { AgentRunner, RunInput, RunResult, ObservedToolCall } from './runner.js';
import { AgentRunError } from './runner.js';

/** Map our sandbox enum to Codex's SandboxMode. */
function toCodexSandbox(sandbox: 'read-only' | 'workspace-write'): 'read-only' | 'workspace-write' {
  return sandbox;
}

export interface CodexRunnerOptions {
  /** Extra Codex CLI config overrides (`--config key=value`). */
  codexOptions?: CodexOptions;
  /** Default model id. */
  model?: string;
  /**
   * Path to a locally installed `codex` CLI to spawn instead of the SDK's
   * bundled vendored binary (arch §6.5.1). Resolved by cli-resolver.ts and
   * passed through to the SDK as `codexPathOverride`. `undefined` → SDK default.
   */
  codexPathOverride?: string;
}

export class CodexAgentRunner implements AgentRunner {
  readonly backend = 'codex' as const;

  constructor(private readonly opts: CodexRunnerOptions = {}) {}

  async run(input: RunInput): Promise<RunResult> {
    let codex: Codex;
    let thread: Thread;
    try {
      // Merge the SDK base options with an optional local-CLI override
      // (arch §6.5.1). When codexPathOverride is undefined the SDK resolves its
      // bundled vendored binary (default behavior).
      const codexOptions: CodexOptions = {
        ...(this.opts.codexOptions ?? {}),
        ...(this.opts.codexPathOverride
          ? { codexPathOverride: this.opts.codexPathOverride }
          : {}),
      };
      codex = new Codex(codexOptions);
      thread = codex.startThread({
        workingDirectory: input.workdir,
        sandboxMode: toCodexSandbox(input.sandbox),
        // Auto-execute (architecture.md §6.3): no pre-write approval.
        approvalPolicy: 'never',
        ...(this.opts.model ? { model: this.opts.model } : {}),
        // The workdir is staged by the caller and may not be a git repo.
        skipGitRepoCheck: true,
      });
    } catch (e) {
      throw new AgentRunError(`Codex thread start failed: ${(e as Error).message}`, e);
    }

    try {
      // SDK `Input = string | UserInput[]`. A bare string is the simplest valid
      // form; the prior `{ type: 'message', content }` object matched no union
      // member (valid variants are `text`/`local_image`) and was force-cast past
      // the type checker, which the SDK then tried to iterate → "input is not
      // iterable".
      const userInput: Input = input.prompt;
      const turn = await thread.run(userInput, input.signal ? { signal: input.signal } : undefined);

      const text = turn.finalResponse ?? '';
      const toolCalls: ObservedToolCall[] = [];
      for (const item of turn.items) {
        const tc = codexItemToToolCall(item);
        if (tc) toolCalls.push(tc);
      }

      const usage = turn.usage;
      return {
        text,
        toolCalls,
        inputTokens: usage?.input_tokens,
        outputTokens: usage?.output_tokens,
        isError: false,
      };
    } catch (e) {
      throw new AgentRunError(`Codex run failed: ${(e as Error).message}`, e);
    }
  }
}

/** Extract an ObservedToolCall from a ThreadItem, if it represents a tool call. */
function codexItemToToolCall(item: ThreadItem): ObservedToolCall | null {
  const it = item as { type?: string; [k: string]: unknown };
  switch (it.type) {
    case 'command_execution':
      return {
        tool: 'command_execution',
        args: (it as { command?: unknown[] }).command,
      };
    case 'mcp_tool_call':
      return {
        tool: `mcp:${(it as { server?: string; name?: string }).server ?? '?'}/${(it as { name?: string }).name ?? '?'}`,
        args: (it as { arguments?: unknown }).arguments,
      };
    default:
      return null;
  }
}
