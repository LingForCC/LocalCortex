import { describe, it, expect } from 'vitest';
import { parseStatusBlock } from './status-parser.js';

describe('parseStatusBlock', () => {
  it('parses a clean status block on its own line', () => {
    const out = parseStatusBlock('All done.\n{"status":"done","reason":"merged"}');
    expect(out).toEqual({ status: 'done', reason: 'merged' });
  });

  it('returns active status', () => {
    const out = parseStatusBlock('{"status":"active"}');
    expect(out).toEqual({ status: 'active' });
  });

  it('returns error status', () => {
    const out = parseStatusBlock('{"status":"error","reason":"auth failed"}');
    expect(out).toEqual({ status: 'error', reason: 'auth failed' });
  });

  it('finds the block embedded mid-message (lenient scan)', () => {
    const out = parseStatusBlock(
      'Looking at the MR now.\n{"status":"done","reason":"merged"}\nThat is all.',
    );
    expect(out).toEqual({ status: 'done', reason: 'merged' });
  });

  it('returns the FIRST valid status block when several exist', () => {
    const out = parseStatusBlock('{"status":"active"} later {"status":"done"}');
    expect(out?.status).toBe('active');
  });

  it('ignores JSON objects that are not status blocks', () => {
    const out = parseStatusBlock('{"foo":"bar","baz":123} {"status":"done"}');
    expect(out?.status).toBe('done');
  });

  it('skips malformed JSON and keeps scanning', () => {
    const out = parseStatusBlock('{not json} {"status":"done","reason":"ok"}');
    expect(out).toEqual({ status: 'done', reason: 'ok' });
  });

  it('handles nested JSON without false-positive depth miscounts', () => {
    const out = parseStatusBlock('{"meta":{"a":1}} {"status":"error","reason":"x"}');
    expect(out).toEqual({ status: 'error', reason: 'x' });
  });

  it('ignores braces that appear inside string literals', () => {
    // The `}` inside the reason string must not close the object early.
    const out = parseStatusBlock('{"status":"done","reason":"closed by {automation}"}');
    expect(out).toEqual({ status: 'done', reason: 'closed by {automation}' });
  });

  it('returns null when no status block is present', () => {
    expect(parseStatusBlock('Just a normal agent message.')).toBeNull();
  });

  it('returns null for a block with an invalid status value', () => {
    expect(parseStatusBlock('{"status":"pending"}')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseStatusBlock('')).toBeNull();
  });

  it('does not include reason when it is empty', () => {
    const out = parseStatusBlock('{"status":"done","reason":""}');
    expect(out).toEqual({ status: 'done' });
    expect(out).not.toHaveProperty('reason');
  });

  it('tolerates extra whitespace and fields in the block', () => {
    const out = parseStatusBlock('{"status" : "done", "reason":"ok", "extra": 1}');
    expect(out).toEqual({ status: 'done', reason: 'ok' });
  });
});
