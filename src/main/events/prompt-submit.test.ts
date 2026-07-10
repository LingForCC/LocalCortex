import { describe, it, expect } from 'vitest';
import {
  isPromptSubmitEvent,
  decideHandoffPromptMode,
  readSessionId,
  buildPromptSubmitPrompt,
  type PromptSubmitHandoffLookup,
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
  it('true for the two known prompt-submit event types', () => {
    expect(isPromptSubmitEvent(ZCODE_PROMPT_SUBMIT_EVENT)).toBe(true);
    expect(isPromptSubmitEvent(CODEX_PROMPT_SUBMIT_EVENT)).toBe(true);
  });

  it('false for completion events and arbitrary types', () => {
    expect(isPromptSubmitEvent('zcode.session-complete')).toBe(false);
    expect(isPromptSubmitEvent('codex.session-complete')).toBe(false);
    expect(isPromptSubmitEvent('build.failed')).toBe(false);
    expect(isPromptSubmitEvent('')).toBe(false);
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
