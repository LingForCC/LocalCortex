import { describe, it, expect } from 'vitest';
import { parseConfigFile } from './config-loader.js';

/**
 * The file-based mcp-servers.json has been retired — server configs now live in
 * the `mcp_servers` DB table. This module retains only `parseConfigFile`, used
 * by McpServersRepository.importFromFile for the one-time legacy import. The
 * round-trip / load / ensure tests have moved to the repository's own tests.
 */
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
