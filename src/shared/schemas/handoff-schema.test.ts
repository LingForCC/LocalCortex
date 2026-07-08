import { describe, it, expect } from 'vitest';
import { HandoffSchema, CreateHandoffSchema } from './handoff-schema.js';

/** A minimal valid handoff input; tests override fields as needed. */
function validHandoff() {
  return {
    id: 'h1',
    sessionId: 'sess_abc',
    context: { parentTaskId: 'o2LOz5FWVIj', taskManager: 'omnifocus' },
    status: 'pending' as const,
    createdAt: '2026-07-08T00:00:00Z',
    updatedAt: '2026-07-08T00:00:00Z',
  };
}

describe('HandoffSchema', () => {
  it('H-S1: parses a valid handoff with all fields', () => {
    const h = HandoffSchema.parse(validHandoff());
    expect(h.id).toBe('h1');
    expect(h.context).toEqual({ parentTaskId: 'o2LOz5FWVIj', taskManager: 'omnifocus' });
    expect(h.status).toBe('pending');
  });

  it('H-S2: context omitted → defaults to {}', () => {
    const { context: _omit, ...rest } = validHandoff();
    void _omit;
    const h = HandoffSchema.parse(rest);
    expect(h.context).toEqual({});
  });

  it('H-S3: empty id → rejects', () => {
    expect(() => HandoffSchema.parse({ ...validHandoff(), id: '' })).toThrow();
  });

  it('H-S4: empty sessionId → rejects', () => {
    expect(() => HandoffSchema.parse({ ...validHandoff(), sessionId: '' })).toThrow();
  });

  it('H-S5: status not in enum → rejects', () => {
    expect(() => HandoffSchema.parse({ ...validHandoff(), status: 'bogus' })).toThrow();
  });

  it('H-S6: fulfilledRunId non-positive → rejects', () => {
    expect(() => HandoffSchema.parse({ ...validHandoff(), fulfilledRunId: 0 })).toThrow();
    expect(() => HandoffSchema.parse({ ...validHandoff(), fulfilledRunId: -3 })).toThrow();
  });

  it('H-S6b: fulfilledRunId positive → parses', () => {
    const h = HandoffSchema.parse({ ...validHandoff(), fulfilledRunId: 7 });
    expect(h.fulfilledRunId).toBe(7);
  });

  it('H-S7: reminderTitle optional — omitted parses', () => {
    const h = HandoffSchema.parse(validHandoff());
    expect(h.reminderTitle).toBeUndefined();
  });

  it('H-S7b: reminderTitle provided → parses', () => {
    const h = HandoffSchema.parse({ ...validHandoff(), reminderTitle: 'Review agent work' });
    expect(h.reminderTitle).toBe('Review agent work');
  });
});

describe('CreateHandoffSchema', () => {
  it('H-C1: valid with context parses', () => {
    const input = CreateHandoffSchema.parse({
      sessionId: 'sess_abc',
      context: { parentTaskId: 'x' },
    });
    expect(input.sessionId).toBe('sess_abc');
    expect(input.context).toEqual({ parentTaskId: 'x' });
  });

  it('H-C2: empty sessionId → rejects', () => {
    expect(() => CreateHandoffSchema.parse({ sessionId: '', context: {} })).toThrow();
  });

  it('H-C3: context omitted → defaults to {}', () => {
    const input = CreateHandoffSchema.parse({ sessionId: 'sess_abc' });
    expect(input.context).toEqual({});
  });

  it('H-C4: reminderTitle optional', () => {
    const without = CreateHandoffSchema.parse({ sessionId: 'sess_abc' });
    expect(without.reminderTitle).toBeUndefined();
    const withTitle = CreateHandoffSchema.parse({
      sessionId: 'sess_abc',
      reminderTitle: 'Review',
    });
    expect(withTitle.reminderTitle).toBe('Review');
  });
});
