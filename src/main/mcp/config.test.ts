import { describe, it, expect } from 'vitest';
import {
  serializeForClaude,
  serializeForCodex,
  assertNoPlaceholders,
  serversWithPlaceholder,
  PlaceholderTokenError,
} from './config.js';
import type { ResolvedMcpServers } from '@shared/types';

const servers: ResolvedMcpServers = {
  'github-personal': {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_abc' },
  },
  todoist: {
    command: 'npx',
    args: ['-y', 'todoist-mcp'],
    env: { TODOIST_API_TOKEN: 'tod_abc' },
  },
};

describe('serializeForClaude', () => {
  it('produces the Claude options.mcpServers shape', () => {
    const out = serializeForClaude({ github: servers['github-personal']! });
    expect(out['github']).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_abc' },
    });
  });

  it('returns independent copies', () => {
    const out = serializeForClaude(servers);
    out['todoist']!.args.push('X');
    expect(servers['todoist']!.args).not.toContain('X');
  });
});

describe('serializeForCodex', () => {
  it('emits mcp_servers tables and approval_policy = "never"', () => {
    const toml = serializeForCodex({ 'github-personal': servers['github-personal']! });
    expect(toml).toContain('[mcp_servers."github-personal"]');
    expect(toml).toContain('command = "npx"');
    expect(toml).toContain('args = ["-y", "@modelcontextprotocol/server-github"]');
    expect(toml).toContain('[mcp_servers."github-personal".env]');
    expect(toml).toContain('GITHUB_PERSONAL_ACCESS_TOKEN = "ghp_abc"');
    expect(toml).toContain('approval_policy = "never"');
  });

  it('omits the env table when env is empty', () => {
    const toml = serializeForCodex({ bare: { command: 'node', args: ['x'], env: {} } });
    expect(toml).not.toContain('.env]');
  });

  it('escapes quotes and backslashes in values', () => {
    const toml = serializeForCodex({
      x: { command: 'node', args: [], env: { K: 'a"b\\c' } },
    });
    expect(toml).toContain('K = "a\\"b\\\\c"');
  });

  it('quotes bare-unsafe env keys', () => {
    const toml = serializeForCodex({
      x: { command: 'node', args: [], env: { 'dotted.key': 'v' } },
    });
    expect(toml).toContain('"dotted.key" = "v"');
  });

  it('honors a custom approval policy', () => {
    const toml = serializeForCodex(
      { x: { command: 'node', args: [], env: {} } },
      { approvalPolicy: 'on-request' },
    );
    expect(toml).toContain('approval_policy = "on-request"');
  });
});

describe('placeholder checks', () => {
  it('lists servers with a placeholder token', () => {
    const withPh: ResolvedMcpServers = {
      a: { command: 'npx', args: [], env: { T: '<your-token-here>' } },
      b: { command: 'npx', args: [], env: { T: 'real' } },
    };
    expect(serversWithPlaceholder(withPh)).toEqual(['a']);
  });

  it('assertNoPlaceholders throws listing offenders', () => {
    const withPh: ResolvedMcpServers = {
      a: { command: 'npx', args: [], env: { T: '<your-token-here>' } },
    };
    expect(() => assertNoPlaceholders(withPh)).toThrow(PlaceholderTokenError);
    expect(() => assertNoPlaceholders(withPh)).toThrow(/a/);
  });

  it('assertNoPlaceholders passes when all tokens are real', () => {
    expect(() => assertNoPlaceholders(servers)).not.toThrow();
  });
});
