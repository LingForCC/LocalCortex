import { describe, it, expect } from 'vitest';
import { renderTemplate, buildPrompt, STATUS_CONTRACT } from './prompt-builder.js';

describe('renderTemplate', () => {
  it('renders simple top-level variables', () => {
    expect(
      renderTemplate('Session in {{workdir}}: {{summary}}', {
        workdir: '/x',
        summary: 'done',
      }),
    ).toBe('Session in /x: done');
  });

  it('renders nested variables via dotted paths', () => {
    expect(renderTemplate('{{event.workdir}}', { event: { workdir: '/a' } })).toBe('/a');
  });

  it('renders unknown variables as empty string', () => {
    expect(renderTemplate('a{{missing}}b', {})).toBe('ab');
  });

  it('renders null/undefined as empty string', () => {
    // Two separate bracket groups → both placeholders collapse to empty.
    expect(renderTemplate('[{{a}}][{{b}}]', { a: null, b: undefined })).toBe('[][]');
    expect(renderTemplate('x{{a}}y', { a: null })).toBe('xy');
  });

  it('renders object values as empty string (not "[object Object]")', () => {
    expect(renderTemplate('{{a}}', { a: { x: 1 } })).toBe('');
  });

  it('stringifies numbers and booleans', () => {
    expect(renderTemplate('{{n}}/{{b}}', { n: 42, b: true })).toBe('42/true');
  });

  it('tolerates whitespace inside braces', () => {
    expect(renderTemplate('{{  workdir  }}', { workdir: '/x' })).toBe('/x');
  });

  it('leaves text without placeholders unchanged', () => {
    expect(renderTemplate('no placeholders here', { a: 1 })).toBe('no placeholders here');
  });
});

describe('buildPrompt', () => {
  const servers = {
    gitlab: { command: 'npx', args: ['x'], env: { T: 'a' } },
    todoist: { command: 'npx', args: ['y'], env: { T: 'b' } },
  };

  it('assembles rendered rule + servers + status contract', () => {
    const out = buildPrompt({
      rule: { rule: 'Do the thing in {{workdir}}', mcpServers: ['gitlab'] },
      servers,
      eventPayload: { workdir: '/code' },
    });
    expect(out).toContain('Do the thing in /code');
    expect(out).toContain('gitlab');
    expect(out).toContain('todoist');
    expect(out).toContain(STATUS_CONTRACT);
  });

  it('does not render templates for tick-triggered runs (no payload)', () => {
    const out = buildPrompt({
      rule: { rule: 'Fetch MR !23494.', mcpServers: ['gitlab'] },
      servers,
    });
    expect(out).toContain('Fetch MR !23494.');
    expect(out).not.toContain('{{'); // no unrendered placeholders either
  });

  it('lists no servers when none attached', () => {
    const out = buildPrompt({
      rule: { rule: 'r', mcpServers: [] },
      servers: {},
    });
    expect(out).toContain('No MCP servers are attached');
  });
});
