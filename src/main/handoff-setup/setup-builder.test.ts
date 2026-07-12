import { describe, it, expect } from 'vitest';
import {
  buildHandoffRule,
  applyComboFieldsToRule,
  HANDOFF_RULE_NAME,
  DEFAULT_HANDOFF_RULE_TEXT,
} from './setup-builder.js';
import { RuleSchema } from '@shared/schemas/rule-schema';
import type { AgentEntry, TaskManagerEntry, Rule } from '@shared/types';

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
    const rule = buildHandoffRule(makeAgent(), makeTaskManager(), 'claude', { id: 'r1' });
    expect(rule.trigger).toEqual({ type: 'event', eventType: 'zcode.session-complete' });
  });

  it('uses the caller-supplied per-combo id', () => {
    const rule = buildHandoffRule(makeAgent(), makeTaskManager(), 'claude', { id: 'combo-xyz' });
    expect(rule.id).toBe('combo-xyz');
  });

  it('defaults the name when none is provided', () => {
    const rule = buildHandoffRule(makeAgent(), makeTaskManager(), 'claude', { id: 'r1' });
    expect(rule.name).toBe(HANDOFF_RULE_NAME);
  });

  it('honors a caller-supplied name', () => {
    const rule = buildHandoffRule(makeAgent(), makeTaskManager(), 'claude', {
      id: 'r1',
      name: 'ZCode → OmniFocus',
    });
    expect(rule.name).toBe('ZCode → OmniFocus');
  });

  it('uses the agent session-complete event type (not prompt-submit)', () => {
    const rule = buildHandoffRule(makeAgent(), makeTaskManager(), 'codex', { id: 'r1' });
    expect(rule.trigger.type).toBe('event');
    expect((rule.trigger as { eventType: string }).eventType).toBe('zcode.session-complete');
  });

  it('uses the independently-chosen backend (not derived from the agent)', () => {
    const claudeRule = buildHandoffRule(makeAgent(), makeTaskManager(), 'claude', { id: 'r1' });
    const codexRule = buildHandoffRule(makeAgent(), makeTaskManager(), 'codex', { id: 'r2' });
    expect(claudeRule.backend).toBe('claude');
    expect(codexRule.backend).toBe('codex');
  });

  it('references the task manager MCP server name', () => {
    const rule = buildHandoffRule(
      makeAgent(),
      makeTaskManager({ mcpServerName: 'todoist' }),
      'claude',
      { id: 'r1' },
    );
    expect(rule.mcpServers).toEqual(['todoist']);
  });

  it('defaults to read-only sandbox', () => {
    const rule = buildHandoffRule(makeAgent(), makeTaskManager(), 'claude', { id: 'r1' });
    expect(rule.sandbox).toBe('read-only');
  });

  it('uses the default review-subtask prompt text', () => {
    const rule = buildHandoffRule(makeAgent(), makeTaskManager(), 'claude', { id: 'r1' });
    expect(rule.rule).toBe(DEFAULT_HANDOFF_RULE_TEXT);
  });

  it('is enabled by default', () => {
    const rule = buildHandoffRule(makeAgent(), makeTaskManager(), 'claude', { id: 'r1' });
    expect(rule.enabled).toBe(true);
  });

  it('references agent and task manager labels in notes', () => {
    const rule = buildHandoffRule(
      makeAgent({ label: 'My Agent' }),
      makeTaskManager({ label: 'My TM' }),
      'claude',
      { id: 'r1' },
    );
    expect(rule.notes).toContain('My Agent');
    expect(rule.notes).toContain('My TM');
  });

  it('passes validation through RuleSchema (no parse error)', () => {
    const rule = buildHandoffRule(makeAgent(), makeTaskManager(), 'codex', { id: 'r1' });
    expect(() => RuleSchema.parse(rule)).not.toThrow();
  });
});

describe('applyComboFieldsToRule', () => {
  function makeEditedRule(overrides: Partial<Rule> = {}): Rule {
    return {
      ...buildHandoffRule(makeAgent(), makeTaskManager(), 'claude', { id: 'r1' }),
      rule: 'CUSTOM PROMPT — do not clobber',
      model: 'gpt-5',
      modelReasoningEffort: 'high',
      notes: 'CUSTOM NOTES — keep',
      ...overrides,
    };
  }

  it('overwrites only the combo-owned trigger / servers / backend', () => {
    const original = makeEditedRule();
    const updated = applyComboFieldsToRule(
      original,
      makeAgent({ id: 'codex', sessionCompleteEventType: 'codex.session-complete' }),
      makeTaskManager({ mcpServerName: 'todoist' }),
      'codex',
      {},
    );
    expect((updated.trigger as { eventType: string }).eventType).toBe('codex.session-complete');
    expect(updated.mcpServers).toEqual(['todoist']);
    expect(updated.backend).toBe('codex');
  });

  it('preserves user-edited prompt, model, and notes', () => {
    const original = makeEditedRule();
    const updated = applyComboFieldsToRule(
      original,
      makeAgent({ sessionCompleteEventType: 'codex.session-complete' }),
      makeTaskManager(),
      'codex',
      {},
    );
    expect(updated.rule).toBe('CUSTOM PROMPT — do not clobber');
    expect(updated.model).toBe('gpt-5');
    expect(updated.modelReasoningEffort).toBe('high');
    expect(updated.notes).toBe('CUSTOM NOTES — keep');
  });

  it('preserves the existing id and enabled flag', () => {
    const original = makeEditedRule({ id: 'r1', enabled: false });
    const updated = applyComboFieldsToRule(
      original,
      makeAgent({ sessionCompleteEventType: 'codex.session-complete' }),
      makeTaskManager(),
      'codex',
      {},
    );
    expect(updated.id).toBe('r1');
    expect(updated.enabled).toBe(false);
  });

  it('updates the name when provided, preserves it otherwise', () => {
    const original = makeEditedRule({ name: 'Old name' });
    expect(
      applyComboFieldsToRule(original, makeAgent(), makeTaskManager(), 'claude', {
        name: 'New name',
      }).name,
    ).toBe('New name');
    expect(
      applyComboFieldsToRule(original, makeAgent(), makeTaskManager(), 'claude', {}).name,
    ).toBe('Old name');
  });

  it('result passes RuleSchema validation', () => {
    const original = makeEditedRule();
    const updated = applyComboFieldsToRule(
      original,
      makeAgent({ sessionCompleteEventType: 'codex.session-complete' }),
      makeTaskManager({ mcpServerName: 'todoist' }),
      'codex',
      { name: 'Codex combo' },
    );
    expect(() => RuleSchema.parse(updated)).not.toThrow();
  });
});
