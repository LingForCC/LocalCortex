import { describe, expect, it } from 'vitest';

import { extractOmniFocusTaskId } from './task-id';

describe('extractOmniFocusTaskId', () => {
  it('extracts the task id from an OmniFocus task deep-link', () => {
    expect(extractOmniFocusTaskId('omnifocus:///task/fBXk7mWu3Ud')).toBe('fBXk7mWu3Ud');
  });

  it('strips surrounding whitespace from a pasted link', () => {
    expect(extractOmniFocusTaskId('  omnifocus:///task/fBXk7mWu3Ud  ')).toBe('fBXk7mWu3Ud');
  });

  it('strips a trailing slash from the path', () => {
    expect(extractOmniFocusTaskId('omnifocus:///task/fBXk7mWu3Ud/')).toBe('fBXk7mWu3Ud');
  });

  it('passes a bare task id through unchanged', () => {
    expect(extractOmniFocusTaskId('fBXk7mWu3Ud')).toBe('fBXk7mWu3Ud');
  });

  it('passes unrelated text through unchanged', () => {
    expect(extractOmniFocusTaskId('review the PR')).toBe('review the PR');
  });

  it('passes an empty string through unchanged', () => {
    expect(extractOmniFocusTaskId('')).toBe('');
  });

  it('does not match other OmniFocus scheme paths', () => {
    expect(extractOmniFocusTaskId('omnifocus:///folder/abc')).toBe('omnifocus:///folder/abc');
  });
});
