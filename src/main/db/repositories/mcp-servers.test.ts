import { describe, it, expect, beforeEach } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openMemoryDatabase } from '../client.js';
import { runMigrations } from '../migrate.js';
import { McpServersRepository } from './mcp-servers.js';
import { PLACEHOLDER_TOKEN } from '@shared/constants';
import type { DatabaseSync } from 'node:sqlite';

let db: DatabaseSync;
beforeEach(() => {
  db = openMemoryDatabase();
  runMigrations(db);
});

describe('McpServersRepository — seeding', () => {
  it('seeds the v1 defaults on migration', () => {
    const repo = new McpServersRepository(db);
    const names = repo.list().map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['github', 'gitlab', 'todoist', 'omnifocus']));
  });

  it('marks seeded servers as builtin', () => {
    const repo = new McpServersRepository(db);
    const gh = repo.getByName('github');
    expect(gh?.isBuiltin).toBe(true);
  });

  it('seeds placeholder tokens for github/gitlab/todoist', () => {
    const repo = new McpServersRepository(db);
    expect(repo.placeholderNames()).toEqual(
      expect.arrayContaining(['github', 'gitlab', 'todoist']),
    );
    // omnifocus has no token requirement → not a placeholder.
    expect(repo.placeholderNames()).not.toContain('omnifocus');
  });
});

describe('McpServersRepository — CRUD', () => {
  it('upserts a new server', () => {
    const repo = new McpServersRepository(db);
    const created = repo.upsert({
      name: 'linear',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'linear-mcp'],
      env: { LINEAR_API_KEY: 'lin_abc' },
      isBuiltin: false,
    });
    expect(created.name).toBe('linear');
    expect(repo.getByName('linear')?.env).toEqual({ LINEAR_API_KEY: 'lin_abc' });
  });

  it('upsert overwrites an existing server', () => {
    const repo = new McpServersRepository(db);
    repo.upsert({
      name: 'github',
      transport: 'stdio',
      command: 'custom-cmd',
      args: [],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_real' },
      isBuiltin: true,
    });
    const got = repo.getByName('github');
    expect(got?.command).toBe('custom-cmd');
    expect(got?.env['GITHUB_PERSONAL_ACCESS_TOKEN']).toBe('ghp_real');
  });

  it('deletes a server', () => {
    const repo = new McpServersRepository(db);
    expect(repo.delete('github')).toBe(true);
    expect(repo.getByName('github')).toBeNull();
  });
});

describe('McpServersRepository — getAsConfig', () => {
  it('returns a McpServersFile-shaped object the resolver can consume', () => {
    const repo = new McpServersRepository(db);
    const cfg = repo.getAsConfig();
    expect(cfg.servers).toBeDefined();
    expect(cfg.servers['github']).toEqual({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: PLACEHOLDER_TOKEN },
    });
  });

  it('includes custom servers added via upsert', () => {
    const repo = new McpServersRepository(db);
    repo.upsert({
      name: 'custom',
      transport: 'stdio',
      command: 'my-cmd',
      args: ['--flag'],
      env: {},
      isBuiltin: false,
    });
    const cfg = repo.getAsConfig();
    expect(cfg.servers['custom']?.command).toBe('my-cmd');
  });
});

describe('McpServersRepository — importFromFile', () => {
  it('returns 0 when the file does not exist', () => {
    const repo = new McpServersRepository(db);
    expect(repo.importFromFile('/nonexistent/path/file.json')).toBe(0);
  });

  it('imports servers from a legacy file, overwriting seeds with real tokens', () => {
    // Write a temp file with a real github token + a custom server.
    const dir = mkdtempSync(join(tmpdir(), 'lc-import-'));
    const filePath = join(dir, 'mcp-servers.json');
    writeFileSync(
      filePath,
      JSON.stringify({
        servers: {
          github: {
            transport: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_real_token' },
          },
          mycustom: {
            transport: 'stdio',
            command: 'node',
            args: ['server.js'],
            env: { MY_TOKEN: 'abc' },
          },
        },
      }),
    );

    const repo = new McpServersRepository(db);
    const count = repo.importFromFile(filePath);
    expect(count).toBe(2);

    // The real token should replace the placeholder.
    expect(repo.getByName('github')?.env['GITHUB_PERSONAL_ACCESS_TOKEN']).toBe('ghp_real_token');
    expect(repo.placeholderNames()).not.toContain('github');

    // The custom server should be added.
    expect(repo.getByName('mycustom')?.command).toBe('node');

    // Idempotent: re-import doesn't duplicate.
    expect(repo.importFromFile(filePath)).toBe(2);
    expect(repo.list().filter((s) => s.name === 'mycustom')).toHaveLength(1);
  });

  it('returns 0 for a malformed file (leaves seeds intact)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lc-import-'));
    const filePath = join(dir, 'mcp-servers.json');
    writeFileSync(filePath, '{ not valid json');

    const repo = new McpServersRepository(db);
    expect(repo.importFromFile(filePath)).toBe(0);
    // Seeds untouched.
    expect(repo.getByName('github')).not.toBeNull();
  });
});
