/**
 * Builds the full prompt sent to the agent for a run.
 *
 * Two responsibilities (architecture.md §7 step 4; rule-config-schema.md §2):
 *
 *  1. Render event template variables (`{{workdir}}`, `{{summary}}`, …) into the
 *     user's rule text from the incoming event payload. Tick-triggered rules
 *     have no payload; unknown variables render empty.
 *  2. Assemble the full prompt: rendered rule + the status contract (app-authored,
 *     NOT user-authored) + the list of available MCP servers/tools.
 *
 * Pure logic — no `electron` import, unit-testable in plain Vitest.
 */

import type { Rule, ResolvedMcpServers } from '@shared/types';

/** Matches `{{ variable }}` with optional inner whitespace; captures the name. */
const TEMPLATE_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;

/**
 * Render `{{var}}` placeholders in `text` using `vars`.
 *
 * - Lookup is by key, then by dotted path into nested objects.
 * - Missing / null / object values render as empty string.
 * - Non-string scalars (number/boolean) are stringified.
 *
 * Exposed for unit testing.
 */
export function renderTemplate(text: string, vars: Record<string, unknown>): string {
  return text.replace(TEMPLATE_RE, (_match: string, name: string): string => {
    const value = resolvePath(vars, name);
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return '';
    if (typeof value === 'symbol' || typeof value === 'function') return '';
    // number | boolean | bigint → safe to stringify
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return value.toString();
    }
    // After the guards above, the only remaining primitive is string.
    return typeof value === 'string' ? value : '';
  });
}

/** Resolve a possibly-dotted path (`a.b.c`) against a nested object. */
function resolvePath(vars: Record<string, unknown>, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(vars, path)) return vars[path];
  const parts = path.split('.');
  let cur: unknown = vars;
  for (const part of parts) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * The status contract appended to every run prompt (rule-config-schema.md §2,
 * "Prompt contract"). The agent MUST emit a JSON status block at the end of its
 * final message so the app can decide whether to keep the rule active.
 */
export const STATUS_CONTRACT = [
  '',
  '---',
  'STATUS CONTRACT (required):',
  'At the end of your final response, emit a JSON block on its own line, exactly in this shape:',
  '{"status":"<active|done|error>","reason":"<short explanation>"}',
  '- "active" if the rule goal is not yet met (keep polling / keep watching).',
  '- "done" if the goal has been achieved or is no longer relevant.',
  '- "error" if you could not complete the task (auth failure, item not found, etc.).',
  'This block is parsed by the app to decide whether to continue the rule.',
  'Emit only one such block, as the last thing in your message.',
].join('\n');

/** Build the "available MCP tools" preamble from the resolved servers. */
function describeServers(servers: ResolvedMcpServers): string {
  const names = Object.keys(servers);
  if (names.length === 0) {
    return 'No MCP servers are attached to this run.';
  }
  const lines = names.map((name) => `- ${name}`);
  return ['The following MCP servers are attached and available for tool calls:', ...lines].join(
    '\n',
  );
}

export interface BuildPromptArgs {
  rule: Pick<Rule, 'rule' | 'mcpServers'>;
  servers: ResolvedMcpServers;
  /** Event payload for event-triggered runs; omit for tick-triggered runs. */
  eventPayload?: Record<string, unknown>;
}

/**
 * Assemble the full prompt: rendered rule text + available servers + status contract.
 */
export function buildPrompt({ rule, servers, eventPayload }: BuildPromptArgs): string {
  const renderedRule = eventPayload ? renderTemplate(rule.rule, eventPayload) : rule.rule;

  return [renderedRule, '', describeServers(servers), STATUS_CONTRACT].join('\n');
}
