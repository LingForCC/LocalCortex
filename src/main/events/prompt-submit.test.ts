import { describe, it, expect } from 'vitest';
import {
  isPromptSubmitEvent,
  collectPromptSubmitEventTypes,
  decideHandoffPromptMode,
  readSessionId,
  buildPromptSubmitPrompt,
  type PromptSubmitHandoffLookup,
  type PromptSubmitProfileLike,
  type PromptSubmitAgentLike,
} from './prompt-submit.js';
import { CODEX_PROMPT_SUBMIT_EVENT, ZCODE_PROMPT_SUBMIT_EVENT } from '@shared/constants';
import type { Handoff } from '@shared/types';

/** Build a fake lookup backed by a sessionId → Handoff map. */
function makeRepo(store: Record<string, Handoff | null>): PromptSubmitHandoffLookup {
  return {
    findBySessionId(sessionId: string) {
      return store[sessionId] ?? null;
    },
  };
}

function makeHandoff(overrides: Partial<Handoff> = {}): Handoff {
  return {
    id: 'h1',
    sessionId: 'sess_a',
    context: { parentTaskId: 'x' },
    reminderTitle: undefined,
    enabled: true,
    createdAt: '2026-07-09T00:00:00Z',
    updatedAt: '2026-07-09T00:00:00Z',
    ...overrides,
  };
}

describe('isPromptSubmitEvent', () => {
  // The gate is now membership-driven: nothing is hard-coded, so even the
  // builtin types only pass when present in the allowed set.
  it('true when the type is a member of the allowed set', () => {
    const allowed = new Set([ZCODE_PROMPT_SUBMIT_EVENT, CODEX_PROMPT_SUBMIT_EVENT]);
    expect(isPromptSubmitEvent(ZCODE_PROMPT_SUBMIT_EVENT, allowed)).toBe(true);
    expect(isPromptSubmitEvent(CODEX_PROMPT_SUBMIT_EVENT, allowed)).toBe(true);
  });

  it('false when the type is not in the allowed set', () => {
    const allowed = new Set([ZCODE_PROMPT_SUBMIT_EVENT]);
    expect(isPromptSubmitEvent(CODEX_PROMPT_SUBMIT_EVENT, allowed)).toBe(false);
    expect(isPromptSubmitEvent('foobar.prompt-submit', allowed)).toBe(false);
    expect(isPromptSubmitEvent('zcode.session-complete', allowed)).toBe(false);
    expect(isPromptSubmitEvent('', allowed)).toBe(false);
  });

  it('the builtin types are NOT recognized when the allowed set is empty', () => {
    const allowed = new Set<string>();
    expect(isPromptSubmitEvent(ZCODE_PROMPT_SUBMIT_EVENT, allowed)).toBe(false);
    expect(isPromptSubmitEvent(CODEX_PROMPT_SUBMIT_EVENT, allowed)).toBe(false);
  });
});

describe('collectPromptSubmitEventTypes', () => {
  /** Build an agent fixture. */
  function makeAgent(overrides: Partial<PromptSubmitAgentLike> = {}): PromptSubmitAgentLike {
    return { id: 'zcode', promptSubmitEventType: 'zcode.prompt-submit', ...overrides };
  }

  /** Build a profile fixture (enabled by default). */
  function makeProfile(overrides: Partial<PromptSubmitProfileLike> = {}): PromptSubmitProfileLike {
    return { agentId: 'zcode', enabled: true, ...overrides };
  }

  it('includes the agent promptSubmitEventType for an enabled profile', () => {
    const types = collectPromptSubmitEventTypes(
      [makeProfile({ agentId: 'zcode' })],
      [makeAgent({ id: 'zcode', promptSubmitEventType: 'zcode.prompt-submit' })],
    );
    expect(types).toEqual(new Set(['zcode.prompt-submit']));
  });

  it('excludes the event type when the profile is DISABLED', () => {
    const types = collectPromptSubmitEventTypes(
      [makeProfile({ agentId: 'zcode', enabled: false })],
      [makeAgent({ id: 'zcode' })],
    );
    expect(types).toEqual(new Set());
  });

  it('skips a profile whose agentId has no matching agent row (no throw)', () => {
    const types = collectPromptSubmitEventTypes(
      [makeProfile({ agentId: 'ghost' })],
      [makeAgent({ id: 'zcode' })],
    );
    expect(types).toEqual(new Set());
  });

  it('collects event types across multiple profiles for different agents', () => {
    const types = collectPromptSubmitEventTypes(
      [
        makeProfile({ agentId: 'zcode' }),
        makeProfile({ agentId: 'codex' }),
      ],
      [
        makeAgent({ id: 'zcode', promptSubmitEventType: 'zcode.prompt-submit' }),
        makeAgent({ id: 'codex', promptSubmitEventType: 'codex.prompt-submit' }),
      ],
    );
    expect(types).toEqual(new Set(['zcode.prompt-submit', 'codex.prompt-submit']));
  });

  it('dedupes when multiple enabled profiles reference the same agent', () => {
    const types = collectPromptSubmitEventTypes(
      [
        makeProfile({ agentId: 'zcode' }),
        makeProfile({ agentId: 'zcode' }),
      ],
      [makeAgent({ id: 'zcode', promptSubmitEventType: 'zcode.prompt-submit' })],
    );
    expect(types).toEqual(new Set(['zcode.prompt-submit']));
  });

  it('returns an empty set when there are no profiles', () => {
    const types = collectPromptSubmitEventTypes([], [makeAgent()]);
    expect(types).toEqual(new Set());
  });
});

describe('readSessionId', () => {
  it('reads a string sessionId', () => {
    expect(readSessionId({ sessionId: 'sess_123' })).toBe('sess_123');
  });

  it('returns undefined for missing or non-string values', () => {
    expect(readSessionId({})).toBeUndefined();
    expect(readSessionId({ sessionId: 123 })).toBeUndefined();
    expect(readSessionId({ sessionId: null })).toBeUndefined();
  });
});

describe('decideHandoffPromptMode', () => {
  it("returns 'new' when no handoff exists (null)", () => {
    expect(decideHandoffPromptMode(null)).toBe('new');
  });

  it("returns 'existing' when a handoff row is present (regardless of enabled)", () => {
    expect(decideHandoffPromptMode(makeHandoff({ enabled: true }))).toBe('existing');
    expect(decideHandoffPromptMode(makeHandoff({ enabled: false }))).toBe('existing');
  });
});

describe('buildPromptSubmitPrompt', () => {
  it('returns null when the event has no usable sessionId', () => {
    const repo = makeRepo({});
    const out = buildPromptSubmitPrompt(
      { type: ZCODE_PROMPT_SUBMIT_EVENT, payload: { summary: 'no session' } },
      repo,
    );
    expect(out).toBeNull();
  });

  it('returns null when sessionId is non-string', () => {
    const repo = makeRepo({});
    const out = buildPromptSubmitPrompt(
      { type: ZCODE_PROMPT_SUBMIT_EVENT, payload: { sessionId: 999 } },
      repo,
    );
    expect(out).toBeNull();
  });

  it("new mode: no existing handoff → mode 'new', handoff null", () => {
    const repo = makeRepo({});
    const out = buildPromptSubmitPrompt(
      { type: ZCODE_PROMPT_SUBMIT_EVENT, payload: { sessionId: 'sess_new' } },
      repo,
    );
    expect(out).toEqual({
      sessionId: 'sess_new',
      mode: 'new',
      source: 'zcode',
      handoff: null,
    });
  });

  it("existing mode: handoff exists → mode 'existing', handoff is the row", () => {
    const h = makeHandoff({ id: 'h9', sessionId: 'sess_known', enabled: false });
    const repo = makeRepo({ sess_known: h });
    const out = buildPromptSubmitPrompt(
      { type: CODEX_PROMPT_SUBMIT_EVENT, payload: { sessionId: 'sess_known' } },
      repo,
    );
    expect(out).toEqual({
      sessionId: 'sess_known',
      mode: 'existing',
      source: 'codex',
      handoff: h,
    });
  });

  // Lock in the resume case: an ENABLED handoff yields mode 'existing' (so the
  // popup shows the toggle). This is the exact scenario where a prompt-submit
  // rule run would ALSO be enriched — popup 'existing' + enrichment applies.
  it("existing mode: an ENABLED handoff → mode 'existing' (resume + enrichment case)", () => {
    const h = makeHandoff({ id: 'h_on', sessionId: 'sess_resumed', enabled: true });
    const repo = makeRepo({ sess_resumed: h });
    const out = buildPromptSubmitPrompt(
      { type: ZCODE_PROMPT_SUBMIT_EVENT, payload: { sessionId: 'sess_resumed' } },
      repo,
    );
    expect(out?.mode).toBe('existing');
    expect(out?.handoff?.enabled).toBe(true);
  });

  it('falls back to deriving source from the event type when top-level source is absent', () => {
    const repo = makeRepo({});
    const out = buildPromptSubmitPrompt(
      { type: 'cursor.prompt-submit', payload: { sessionId: 's1' } },
      repo,
    );
    expect(out?.source).toBe('cursor');
  });

  it('uses an explicit top-level source when provided', () => {
    const repo = makeRepo({});
    const out = buildPromptSubmitPrompt(
      { type: ZCODE_PROMPT_SUBMIT_EVENT, source: 'custom', payload: { sessionId: 's1' } },
      repo,
    );
    expect(out?.source).toBe('custom');
  });
});
