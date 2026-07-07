import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseConfigFile,
  serializeConfigFile,
  loadMcpServersFile,
  ensureConfigFile,
} from './config-loader.js';
import { PLACEHOLDER_TOKEN } from '@shared/constants.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lc-mcp-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('parseConfigFile', () => {
  it('parses a well-formed config', () => {
    const cfg = parseConfigFile(
      JSON.stringify({
        servers: {
          gh: { transport: 'stdio', command: 'npx', args: ['-y', 'x'], env: { T: 'v' } },
        },
      }),
    );
    expect(cfg.servers['gh']?.command).toBe('npx');
  });

  it('applies defaults for missing args/env', () => {
    const cfg = parseConfigFile(
      JSON.stringify({ servers: { gh: { transport: 'stdio', command: 'npx' } } }),
    );
    expect(cfg.servers['gh']?.args).toEqual([]);
    expect(cfg.servers['gh']?.env).toEqual({});
  });

  it('throws on invalid JSON', () => {
    expect(() => parseConfigFile('{ not json')).toThrow(/not valid JSON/);
  });

  it('throws on a schema violation (non-stdio transport)', () => {
    expect(() =>
      parseConfigFile(JSON.stringify({ servers: { x: { transport: 'http', command: 'c' } } })),
    ).toThrow();
  });
});

describe('serializeConfigFile / load round-trip', () => {
  it('round-trips through JSON', () => {
    const original = {
      servers: {
        gh: { transport: 'stdio', command: 'npx', args: ['a'], env: { T: 'v' } },
      },
    };
    const cfg1 = parseConfigFile(JSON.stringify(original));
    const text = serializeConfigFile(cfg1);
    const cfg2 = parseConfigFile(text);
    expect(cfg2).toEqual(cfg1);
  });
});

describe('loadMcpServersFile', () => {
  it('returns null when the file does not exist', () => {
    expect(loadMcpServersFile(join(dir, 'nope.json'))).toBeNull();
  });

  it('loads and parses an existing file', () => {
    const p = join(dir, 'c.json');
    writeFileSync(p, JSON.stringify({ servers: { x: { transport: 'stdio', command: 'npx' } } }));
    const cfg = loadMcpServersFile(p);
    expect(cfg?.servers['x']?.command).toBe('npx');
  });
});

describe('ensureConfigFile', () => {
  it('writes the bundled default with 0600 perms when missing', () => {
    const p = join(dir, 'nested', 'mcp-servers.json');
    const res = ensureConfigFile(p, '/abs/omnifocus.js');
    expect(res.created).toBe(true);

    const cfg = parseConfigFile(readFileSync(p, 'utf8'));
    // Four v1 servers present.
    expect(Object.keys(cfg.servers).sort()).toEqual(['github', 'gitlab', 'omnifocus', 'todoist']);
    // Placeholders not filled in by default.
    expect(cfg.servers['github']?.env['GITHUB_PERSONAL_ACCESS_TOKEN']).toBe(PLACEHOLDER_TOKEN);
    // Omnifocus entry points at the resolved path.
    expect(cfg.servers['omnifocus']?.args).toEqual(['/abs/omnifocus.js']);

    const mode = statSync(p).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('does not overwrite an existing file', () => {
    const p = join(dir, 'mcp-servers.json');
    writeFileSync(
      p,
      JSON.stringify({
        servers: { custom: { transport: 'stdio', command: 'my-cmd' } },
      }),
    );
    const res = ensureConfigFile(p, '/abs/omnifocus.js');
    expect(res.created).toBe(false);
    expect(Object.keys(res.config.servers)).toEqual(['custom']);
  });

  it('is idempotent', () => {
    const p = join(dir, 'mcp-servers.json');
    ensureConfigFile(p, '/abs/omnifocus.js');
    const second = ensureConfigFile(p, '/abs/omnifocus.js');
    expect(second.created).toBe(false);
  });
});
