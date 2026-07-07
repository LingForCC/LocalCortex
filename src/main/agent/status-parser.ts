/**
 * Parses the machine-readable status block from an agent transcript.
 *
 * The prompt contract (rule-config-schema.md §2) asks the agent to emit, at the
 * end of its final message, a JSON block like:
 *   {"status":"<active|done|error>","reason":"<short explanation>"}
 *
 * Per architecture.md §8, parsing must be LENIENT:
 * - scan the WHOLE transcript, not just the last line (the block may be embedded
 *   mid-message);
 * - return the FIRST valid status block found;
 * - never throw — a missing/malformed block returns `null`, and the caller
 *   falls back to the structural maxRuns/expiresAt backstops.
 *
 * Pure logic — no `electron` import, unit-testable in plain Vitest.
 */

import type { ParsedStatus, RuleStatus } from '@shared/types';

const STATUS_VALUES: ReadonlySet<RuleStatus> = new Set(['active', 'done', 'error']);

/**
 * Try to interpret a parsed JSON object as a status block.
 * Returns null if it isn't one.
 */
function tryAsStatusBlock(obj: unknown): ParsedStatus | null {
  if (typeof obj !== 'object' || obj === null) return null;
  const rec = obj as Record<string, unknown>;
  const status = rec['status'];
  if (typeof status !== 'string' || !STATUS_VALUES.has(status as RuleStatus)) return null;
  const reason = rec['reason'];
  const out: ParsedStatus = { status: status as RuleStatus };
  if (typeof reason === 'string' && reason.length > 0) out.reason = reason;
  return out;
}

/**
 * Extract the first valid status block from an agent transcript.
 *
 * Strategy:
 *  1. Find every JSON object candidate in the text (text between `{` and the
 *     matching `}`). A brace-counting scan avoids false positives from nested
 *     objects and is robust to JSON embedded in prose.
 *  2. For each candidate (in order of appearance), `JSON.parse` it and check if
 *     it's a valid status block. Return the first hit.
 *
 * Returns `null` if no valid status block is found.
 */
export function parseStatusBlock(transcript: string): ParsedStatus | null {
  if (!transcript) return null;

  // Collect candidate object substrings via a simple brace matcher.
  for (let i = 0; i < transcript.length; i++) {
    if (transcript[i] !== '{') continue;

    let depth = 0;
    let inString = false;
    let escape = false;
    for (let j = i; j < transcript.length; j++) {
      const ch = transcript[j];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const candidate = transcript.slice(i, j + 1);
          let parsed: unknown;
          try {
            parsed = JSON.parse(candidate);
          } catch {
            // Not valid JSON — skip this candidate and continue scanning past it.
            i = j;
            break;
          }
          const block = tryAsStatusBlock(parsed);
          if (block) return block;
          // Valid JSON but not a status block — keep scanning.
          i = j;
          break;
        }
      }
    }
  }
  return null;
}
