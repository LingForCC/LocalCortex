/**
 * Claude Agent SDK runner.
 *
 * Spec: docs/architecture.md §5.5, §6.1-§6.3; docs/mcp-servers.md §5.1.
 *
 *  - MCP config is per-call: `options.mcpServers` (a dict of stdio servers).
 *  - Workdir is `options.cwd`.
 *  - Auto-execute: `permissionMode: 'bypassPermissions'` (no pre-write gate).
 *  - Sandbox: enforced via `allowedTools`/`disallowedTools` (architecture.md §6.2).
 *
 * The SDK's `query()` returns an async generator of SDKMessage; we iterate it,
 * accumulate the assistant's text, capture tool calls for observability, and
 * pull token usage off the terminal `result` message.
 */

import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ResolvedMcpServers } from '@shared/types';
import { serializeForClaude, assertNoPlaceholders } from '../mcp/config.js';
import type { AgentRunner, RunInput, RunResult, ObservedToolCall, RunEventCallback } from './runner.js';
import { AgentRunError } from './runner.js';

/** Tool names permitted in read-only mode (architecture.md §6.2). */
const READ_ONLY_ALLOWED_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'LS',
  // MCP tool calls are namespaced `mcp__<server>__<tool>`; allow all reads from
  // attached MCP servers so the agent can still fetch source state.
  'mcp__*',
];

export interface ClaudeRunnerOptions {
  /** Override the path to the claude-code executable (defaults to SDK resolution). */
  pathToClaudeCodeExecutable?: string;
  /** Default model id (optional; SDK default if unset). */
  model?: string;
}

export class ClaudeAgentRunner implements AgentRunner {
  readonly backend = 'claude' as const;

  constructor(private readonly opts: ClaudeRunnerOptions = {}) {}

  async run(input: RunInput, onEvent?: RunEventCallback): Promise<RunResult> {
    // Validate the servers we're about to attach BEFORE spawning.
    assertNoPlaceholders(input.servers);

    const mcpServers = serializeForClaude(input.servers);
    const options: Options = {
      cwd: input.workdir,
      mcpServers,
      // Auto-execute (architecture.md §6.3): no pre-write approval gate.
      permissionMode: 'bypassPermissions',
      maxTurns: input.maxTurns ?? 50,
    };
    if (input.sandbox === 'read-only') {
      options.allowedTools = READ_ONLY_ALLOWED_TOOLS;
    }
    if (this.opts.model) options.model = this.opts.model;
    if (this.opts.pathToClaudeCodeExecutable) {
      options.pathToClaudeCodeExecutable = this.opts.pathToClaudeCodeExecutable;
    }

    let text = '';
    const toolCalls: ObservedToolCall[] = [];
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let isError = false;
    let errorMessage: string | undefined;

    try {
      const stream = query({ prompt: input.prompt, options });

      for await (const msg of stream as AsyncIterable<SDKMessage>) {
        // The SDKMessage union is enormous; narrow via runtime checks on an
        // unknown-typed view so we don't depend on the union's internal shape.
        const m = msg as unknown;
        const type = (m as { type?: string }).type;

        if (type === 'assistant') {
          const content = (m as { message?: { content?: unknown[] } }).message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              const b = block as { type?: string; text?: string; name?: string; input?: unknown };
              if (b.type === 'text' && typeof b.text === 'string') text += b.text;
              else if (b.type === 'tool_use') {
                toolCalls.push({ tool: b.name ?? 'unknown', args: b.input });
                onEvent?.({ type: 'tool_call', tool: b.name ?? 'unknown', args: b.input });
              }
            }
          }
        } else if (type === 'result') {
          const r = m as {
            subtype?: string;
            is_error?: boolean;
            result?: string;
            message?: { text?: string };
            usage?: { input_tokens?: number; output_tokens?: number };
          };
          if (r.subtype === 'error' || (r.subtype === 'success' && r.is_error)) {
            isError = true;
            errorMessage =
              r.subtype === 'error' ? (r.message?.text ?? 'Claude reported an error') : r.result;
          }
          if (r.usage) {
            inputTokens = r.usage.input_tokens;
            outputTokens = r.usage.output_tokens;
          }
        }
      }
    } catch (e) {
      throw new AgentRunError(`Claude agent run failed: ${(e as Error).message}`, e);
    }

    return { text, toolCalls, inputTokens, outputTokens, isError, error: errorMessage };
  }
}

/**
 * Serialize servers into the Claude Agent SDK's `AgentMcpServerSpec` form.
 * Exposed for the lifecycle/run-loop to hand the runner exactly what it needs.
 */
export function serversToClaudeSpec(servers: ResolvedMcpServers): Options['mcpServers'] {
  return serializeForClaude(servers);
}
