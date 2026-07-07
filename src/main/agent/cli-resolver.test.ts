import { describe, it, expect } from 'vitest';
import {
  resolveCodexPath,
  resolveClaudePath,
  resolveOnPath,
  platformBinaryName,
  isExecutablePath,
} from './cli-resolver.js';

describe('platformBinaryName', () => {
  it('appends .exe on win32', () => {
    expect(platformBinaryName('codex')).toBe(
      process.platform === 'win32' ? 'codex.exe' : 'codex',
    );
  });
});

describe('resolveOnPath', () => {
  it('finds node on PATH in CI/dev environments', () => {
    // `node` should be on PATH wherever these tests run.
    const result = resolveOnPath(platformBinaryName('node'));
    expect(result).toBeTruthy();
    expect(result!.endsWith(platformBinaryName('node'))).toBe(true);
  });

  it('returns undefined when the binary is not on a restricted PATH', () => {
    const result = resolveOnPath('definitely-not-a-real-binary-xyz', { PATH: '/usr/bin:/bin' });
    expect(result).toBeUndefined();
  });

  it('returns undefined when PATH env is unset', () => {
    const result = resolveOnPath('node', {});
    expect(result).toBeUndefined();
  });
});

describe('resolveCodexPath / resolveClaudePath', () => {
  it('returns the explicit path when provided (non-empty)', () => {
    expect(resolveCodexPath('/custom/codex')).toBe('/custom/codex');
    expect(resolveClaudePath('/custom/claude')).toBe('/custom/claude');
  });

  it('trims whitespace from the explicit path', () => {
    expect(resolveCodexPath('  /custom/codex  ')).toBe('/custom/codex');
  });

  it('falls through to PATH lookup when explicit is empty/undefined', () => {
    // We can't assert a specific value, but it must not throw and must be
    // string|undefined.
    const v = resolveCodexPath(undefined);
    expect(['string', 'undefined']).toContain(typeof v);
  });
});

describe('isExecutablePath', () => {
  it('accepts an empty string (means auto-detect)', () => {
    expect(isExecutablePath('')).toBe(true);
    expect(isExecutablePath('   ')).toBe(true);
  });

  it('rejects a non-existent path', () => {
    expect(isExecutablePath('/no/such/binary/here')).toBe(false);
  });

  it('accepts an executable that exists (node itself)', () => {
    const nodePath = resolveOnPath(platformBinaryName('node'));
    expect(nodePath).toBeTruthy();
    expect(isExecutablePath(nodePath!)).toBe(true);
  });
});
