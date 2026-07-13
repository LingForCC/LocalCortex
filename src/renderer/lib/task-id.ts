/**
 * OmniFocus deep-link helper. LocalCortex has no domain knowledge of any task
 * manager (see `src/shared/schemas/handoff-schema.ts`), but pasting an OmniFocus
 * task link into a handoff context value is common, so the renderer auto-
 * extracts the trailing task id on paste —
 * `omnifocus:///task/fBXk7mWu3Ud` → `fBXk7mWu3Ud`. No-op for any other input,
 * so manual typing and unrelated values are untouched.
 */

const OMNIFOCUS_TASK_URL = /^omnifocus:\/\/\/task\/(.+)$/;

/**
 * If `value` is an OmniFocus task deep-link, return the trailing task id;
 * otherwise return `value` unchanged.
 */
export function extractOmniFocusTaskId(value: string): string {
  const match = value.trim().match(OMNIFOCUS_TASK_URL);
  const id = match?.[1]; // guarded for noUncheckedIndexedAccess
  if (!id) return value;
  return id.replace(/\/+$/, '').trim();
}
