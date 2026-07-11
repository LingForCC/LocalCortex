/**
 * E2E for Triggers — the event ingress HTTP surface
 * (docs/features/triggers/test-plan.md T-E2/E3).
 *
 * The ingress binds 127.0.0.1:4729 (src/main/index.ts:136). These tests POST
 * synthetic events from the test process and assert both the HTTP response
 * (matched count) and the resulting run (or its absence) in Run history.
 *
 * T-E1 (real Codex hook), T-E4/T-E5 (tick cadence timing) stay manual — the
 * former needs a live Codex session, the latter is gated by the 300s floor.
 */

import { test, expect } from './fixtures/app';
import type { Rule } from '@shared/types';

const INGRESS_URL = 'http://127.0.0.1:4729';

/** POST an event to the ingress; returns { status, body }. */
async function postEvent(
  event: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${INGRESS_URL}/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });
  return { status: res.status, body: await res.json() };
}

/** Create a rule in the running app by invoking the IPC from the renderer. */
async function createRule(window: import('@playwright/test').Page, rule: Rule): Promise<void> {
  await window.evaluate(async (r) => {
    // `window.api` is injected by the preload contextBridge; cast since the
    // Playwright Page type doesn't carry the renderer's global augmentation.
    const api = (
      window as unknown as { api: { rules: { create: (r: unknown) => Promise<unknown> } } }
    ).api;
    await api.rules.create(r);
  }, rule);
}

test.describe('Event ingress', () => {
  test('T-E2: a matching event fires the rule and a run appears', async ({ app }) => {
    await app.completeOnboarding();
    const { window } = app;

    // Create an enabled event rule whose eventType matches what we'll POST.
    await createRule(window, {
      id: 'r_event_match',
      name: 'Event match',
      enabled: true,
      rule: 'Handle the {{summary}} event.',
      trigger: { type: 'event', eventType: 'test.event' },
      mcpServers: ['gitlab'],
      backend: 'claude',
      sandbox: 'read-only',
    });

    const { status, body } = await postEvent({
      type: 'test.event',
      timestamp: new Date().toISOString(),
      payload: { summary: 'something happened' },
    });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, matched: 1 });

    // The matched rule is enqueued → a run row appears (status `error` is fine
    // without credentials; the enqueue is what's asserted). The history row is
    // keyed on ruleId, which we set explicitly when creating the rule.
    await window.getByRole('button', { name: 'Run history' }).click();
    await expect(window.getByRole('row', { name: /r_event_match/ })).toBeVisible({
      timeout: 20_000,
    });
  });

  test('T-E3: a filter that does not match yields matched:0 and no run', async ({ app }) => {
    await app.completeOnboarding();
    const { window } = app;

    // A rule whose filter requires workdir under /expected/* — we POST a
    // payload whose workdir is elsewhere, so the rule must NOT match.
    await createRule(window, {
      id: 'r_event_filter',
      name: 'Event filtered',
      enabled: true,
      rule: 'Handle a filtered event.',
      trigger: { type: 'event', eventType: 'test.filtered', filter: { workdir: '/expected/*' } },
      mcpServers: ['gitlab'],
      backend: 'claude',
      sandbox: 'read-only',
    });

    const { status, body } = await postEvent({
      type: 'test.filtered',
      timestamp: new Date().toISOString(),
      payload: { workdir: '/other/path' },
    });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, matched: 0 });

    // No run should appear for this rule.
    await window.getByRole('button', { name: 'Run history' }).click();
    await expect(window.getByRole('row', { name: /Event filtered/ })).toHaveCount(0);
  });
});
