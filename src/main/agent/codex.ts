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
  type ThreadEvent,
  type Input,
} from '@openai/codex-sdk';
import type {
  AgentRunner,
  RunInput,
  RunResult,
  ObservedToolCall,
  RunEventCallback,
} from './runner.js';
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

  async run(input: RunInput, onEvent?: RunEventCallback): Promise<RunResult> {
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

      // Stream the turn (instead of awaiting `thread.run()`) so we can surface
      // per-item progress via `onEvent` as the agent works. We still reconstruct
      // the same RunResult shape at the end.
      const streamed = await thread.runStreamed(
        userInput,
        input.signal ? { signal: input.signal } : undefined,
      );

      let text = '';
      const toolCalls: ObservedToolCall[] = [];
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      let isError = false;
      let errorMessage: string | undefined;

      for await (const evt of streamed.events as AsyncIterable<ThreadEvent>) {
        switch (evt.type) {
          case 'turn.failed':
            isError = true;
            errorMessage = evt.error.message;
            break;
          case 'turn.completed':
            inputTokens = evt.usage.input_tokens;
            outputTokens = evt.usage.output_tokens;
            break;
          case 'error':
            isError = true;
            errorMessage = evt.message;
            break;
          case 'item.completed': {
            // Capture agent text + tool calls into the final result, and emit
            // progress events for tool calls so the operator can watch the run.
            const item = evt.item as { type?: string; [k: string]: unknown };
            if (item.type === 'agent_message') {
              const t = (item as { text?: string }).text ?? '';
              text += t;
              if (t) onEvent?.({ type: 'assistant_text', text: t });
            } else if (item.type === 'mcp_tool_call') {
              const tool = `mcp:${(item as { server?: string }).server ?? '?'}/${(item as { tool?: string }).tool ?? '?'}`;
              toolCalls.push({ tool, args: (item as { arguments?: unknown }).arguments });
              onEvent?.({ type: 'tool_call', tool, args: (item as { arguments?: unknown }).arguments });
              onEvent?.({
                type: 'tool_result',
                tool,
                ok: (item as { status?: string }).status !== 'failed',
                error: (item as { error?: { message?: string } }).error?.message,
              });
            } else if (item.type === 'command_execution') {
              const cmd = (item as { command?: string }).command;
              toolCalls.push({ tool: 'command_execution', args: cmd });
              onEvent?.({ type: 'tool_call', tool: 'command_execution', args: cmd });
              onEvent?.({
                type: 'tool_result',
                tool: 'command_execution',
                ok: (item as { status?: string }).status !== 'failed',
              });
            }
            break;
          }
          default:
            // thread.started / turn.started / item.started / item.updated are
            // intentionally not surfaced — too chatty for the live log and they
            // duplicate the start/completed signal.
            break;
        }
      }

      return { text, toolCalls, inputTokens, outputTokens, isError, error: errorMessage };
    } catch (e) {
      throw new AgentRunError(`Codex run failed: ${(e as Error).message}`, e);
    }
  }
}
