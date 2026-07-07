import { describe, it, expect } from 'vitest';
import { resolveMcpServers, listServerNames, UndefinedMcpServerError } from './resolver.js';
import type { McpServersFile } from '@shared/types';

const config: McpServersFile = {
  servers: {
    'github-personal': {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_abc' },
    },
    todoist: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'todoist-mcp'],
      env: { TODOIST_API_TOKEN: 'tod_abc' },
    },
  },
};

describe('resolveMcpServers', () => {
  it('resolves each referenced name to a deep copy of its spawn config', () => {
    const out = resolveMcpServers({ id: 'r1', mcpServers: ['github-personal', 'todoist'] }, config);
    expect(Object.keys(out).sort()).toEqual(['github-personal', 'todoist']);
    expect(out['github-personal']).toEqual({
      command: 'npx',
      args: ['-y', 'server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_abc' },
    });
  });

  it('returns independent copies (mutation does not leak)', () => {
    const out = resolveMcpServers({ id: 'r1', mcpServers: ['github-personal'] }, config);
    out['github-personal']!.args.push('MUTATED');
    out['github-personal']!.env['INJECTED'] = 'x';
    expect(config.servers['github-personal']!.args).toEqual(['-y', 'server-github']);
    expect(config.servers['github-personal']!.env).not.toHaveProperty('INJECTED');
  });

  it('throws UndefinedMcpServerError naming the missing server and rule', () => {
    try {
      resolveMcpServers({ id: 'r9', mcpServers: ['does-not-exist'] }, config);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(UndefinedMcpServerError);
      expect((e as UndefinedMcpServerError).serverName).toBe('does-not-exist');
      expect((e as UndefinedMcpServerError).ruleId).toBe('r9');
      expect((e as Error).message).toContain('does-not-exist');
    }
  });

  it('resolves zero servers for an empty mcpServers array', () => {
    expect(resolveMcpServers({ id: 'r1', mcpServers: [] }, config)).toEqual({});
  });
});

describe('listServerNames', () => {
  it('returns the names defined in the config', () => {
    expect(listServerNames(config).sort()).toEqual(['github-personal', 'todoist']);
  });
});
