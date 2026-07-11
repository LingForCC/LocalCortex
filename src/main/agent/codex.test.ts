import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the Codex SDK so the runner is exercised without spawning the real
// `codex` binary. `startThread` is captured as a spy so we can assert on the
// exact `ThreadOptions` object the runner builds — specifically the `model`
// and `modelReasoningEffort` fields (the feature under test).
//
// The mock mirrors the SDK's real surface used by codex.ts:
//   - `Codex` is a class; `new Codex(opts)` returns an instance whose
//     `startThread(opts)` synchronously returns a Thread-like object.
//   - That object's `runStreamed(input)` returns a Promise of
//     `{ events: AsyncIterable<ThreadEvent> }`. We yield a single
//     `turn.completed` event for a clean success path.
//
// Follows the vi.mock + dynamic-import pattern established in
// src/main/ipc/handoffs.test.ts.

const startThreadMock = vi.fn();

vi.mock('@openai/codex-sdk', () => {
  class Codex {
    constructor(_options?: unknown) {}
    startThread = startThreadMock;
  }
  return { Codex };
});

/** Build a Thread-like whose runStreamed yields a clean turn.completed. */
function fakeThread() {
  return {
    runStreamed: vi.fn().mockResolvedValue({
      events: (async function* () {
        yield {
          type: 'turn.completed',
          usage: {
            input_tokens: 1,
            cached_input_tokens: 0,
            output_tokens: 2,
            reasoning_output_tokens: 0,
          },
        };
      })(),
    }),
  };
}

// Import AFTER the mock is registered so CodexAgentRunner sees the stubbed
// `Codex` class. Dynamic import avoids hoisting-order issues with vi.mock.
async function loadRunner() {
  const { CodexAgentRunner } = await import('./codex.js');
  return CodexAgentRunner;
}

import type { RunInput } from './runner.js';
import type { ResolvedMcpServers } from '@shared/types';

/** Minimal valid MCP server config (real token — not a placeholder). */
const servers: ResolvedMcpServers = {
  demo: { command: 'node', args: ['x.js'], env: { KEY: 'val' } },
};

const baseInput: RunInput = {
  prompt: 'say hi',
  workdir: '/tmp',
  sandbox: 'read-only',
  servers,
};

describe('CodexAgentRunner — model + reasoning effort', () => {
  beforeEach(() => {
    startThreadMock.mockReset();
    startThreadMock.mockReturnValue(fakeThread());
  });

  it('passes per-run model + reasoningEffort into startThread', async () => {
    const CodexAgentRunner = await loadRunner();
    const runner = new CodexAgentRunner({});

    await runner.run({
      ...baseInput,
      model: 'gpt-5.6-sol',
      reasoningEffort: 'xhigh',
    });

    const opts = startThreadMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts.model).toBe('gpt-5.6-sol');
    expect(opts.modelReasoningEffort).toBe('xhigh');
  });

  it('falls back to constructor (app-level) defaults when the run omits them', async () => {
    const CodexAgentRunner = await loadRunner();
    const runner = new CodexAgentRunner({
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
    });

    await runner.run(baseInput);

    const opts = startThreadMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts.model).toBe('gpt-5.5');
    expect(opts.modelReasoningEffort).toBe('medium');
  });

  it('per-run override wins over the constructor default', async () => {
    const CodexAgentRunner = await loadRunner();
    const runner = new CodexAgentRunner({
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
    });

    await runner.run({
      ...baseInput,
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
    });

    const opts = startThreadMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts.model).toBe('gpt-5.6-sol');
    expect(opts.modelReasoningEffort).toBe('high');
  });

  it('omits model and modelReasoningEffort when neither run nor default sets them', async () => {
    const CodexAgentRunner = await loadRunner();
    const runner = new CodexAgentRunner({});

    await runner.run(baseInput);

    const opts = startThreadMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts).not.toHaveProperty('model');
    expect(opts).not.toHaveProperty('modelReasoningEffort');
  });

  it('falls back to the constructor default for one field while overriding the other', async () => {
    const CodexAgentRunner = await loadRunner();
    const runner = new CodexAgentRunner({
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
    });

    // Only override model; reasoning effort should fall back to constructor.
    await runner.run({ ...baseInput, model: 'gpt-5.6-sol' });

    const opts = startThreadMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts.model).toBe('gpt-5.6-sol');
    expect(opts.modelReasoningEffort).toBe('medium');
  });
});
