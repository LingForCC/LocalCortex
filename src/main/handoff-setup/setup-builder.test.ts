import { describe, it, expect } from 'vitest';
import {
  buildHandoffRule,
  HANDOFF_RULE_ID,
  HANDOFF_RULE_NAME,
  DEFAULT_HANDOFF_RULE_TEXT,
} from './setup-builder.js';
import { RuleSchema } from '@shared/schemas/rule-schema';
import type { AgentEntry, TaskManagerEntry } from '@shared/types';

function makeAgent(overrides: Partial<AgentEntry> = {}): AgentEntry {
  return {
    id: 'zcode',
    label: 'ZCode',
    description: 'ZCode agent',
    sessionCompleteEventType: 'zcode.session-complete',
    promptSubmitEventType: 'zcode.prompt-submit',
    source: 'zcode',
    installInstructions: 'Install the plugin.',
    isBuiltin: true,
    createdAt: '2026-07-10T00:00:00Z',
    updatedAt: '2026-07-10T00:00:00Z',
    ...overrides,
  };
}

function makeTaskManager(overrides: Partial<TaskManagerEntry> = {}): TaskManagerEntry {
  return {
    id: 'omnifocus',
    label: 'OmniFocus',
    description: 'OmniFocus task manager',
    mcpServerName: 'omnifocus',
    requiresToken: false,
    tokenEnvVar: null,
    setupInstructions: 'Build the MCP server.',
    isBuiltin: true,
    createdAt: '2026-07-10T00:00:00Z',
    updatedAt: '2026-07-10T00:00:00Z',
    ...overrides,
  };
}

describe('buildHandoffRule', () => {
  it('builds a rule with the correct trigger from the agent', () => {
    const rule = buildHandoffRule(makeAgent(), makeTaskManager(), 'claude');
    expect(rule.trigger).toEqual({ type: 'event', eventType: 'zcode.session-complete' });
  });

  it('uses the agent session-complete event type (not prompt-submit)', () => {
    const rule = buildHandoffRule(makeAgent(), makeTaskManager(), 'codex');
    expect(rule.trigger.type).toBe('event');
    expect((rule.trigger as { eventType: string }).eventType).toBe('zcode.session-complete');
  });

  it('uses the independently-chosen backend (not derived from the agent)', () => {
    const claudeRule = buildHandoffRule(makeAgent(), makeTaskManager(), 'claude');
    const codexRule = buildHandoffRule(makeAgent(), makeTaskManager(), 'codex');
    expect(claudeRule.backend).toBe('claude');
    expect(codexRule.backend).toBe('codex');
  });

  it('references the task manager MCP server name', () => {
    const rule = buildHandoffRule(
      makeAgent(),
      makeTaskManager({ mcpServerName: 'todoist' }),
      'claude',
    );
    expect(rule.mcpServers).toEqual(['todoist']);
  });

  it('defaults to read-only sandbox', () => {
    const rule = buildHandoffRule(makeAgent(), makeTaskManager(), 'claude');
    expect(rule.sandbox).toBe('read-only');
  });

  it('uses the default review-subtask prompt text', () => {
    const rule = buildHandoffRule(makeAgent(), makeTaskManager(), 'claude');
    expect(rule.rule).toBe(DEFAULT_HANDOFF_RULE_TEXT);
  });

  it('uses the deterministic id and name', () => {
    const rule = buildHandoffRule(makeAgent(), makeTaskManager(), 'claude');
    expect(rule.id).toBe(HANDOFF_RULE_ID);
    expect(rule.name).toBe(HANDOFF_RULE_NAME);
  });

  it('is enabled by default', () => {
    const rule = buildHandoffRule(makeAgent(), makeTaskManager(), 'claude');
    expect(rule.enabled).toBe(true);
  });

  it('references agent and task manager labels in notes', () => {
    const rule = buildHandoffRule(
      makeAgent({ label: 'My Agent' }),
      makeTaskManager({ label: 'My TM' }),
      'claude',
    );
    expect(rule.notes).toContain('My Agent');
    expect(rule.notes).toContain('My TM');
  });

  it('passes validation through RuleSchema (no parse error)', () => {
    const rule = buildHandoffRule(makeAgent(), makeTaskManager(), 'codex');
    expect(() => RuleSchema.parse(rule)).not.toThrow();
  });
});
