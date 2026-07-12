/**
 * E2E for the Handoffs panel
 * (docs/features/handoffs/test-plan.md H-E2E1..H-E2E5).
 *
 * Covers the registration form + list table: registering a handoff, persistence
 * across reload, toggling enable/disable, deleting, and inline validation.
 *
 * The prompt-submit popup path (H-E2E6..H-E2E9) lives in handoff-prompt.spec.ts.
 * Runtime enrichment behavior is covered by unit tests (handoff-enrichment,
 * prompt-submit, ingress) — these E2E tests cover only the panel UI.
 *
 * Uses the shared fixture (isolated HOME + fresh DB per test).
 */

import { test, expect } from './fixtures/app';

/** Navigate to the Handoffs tab. Defined locally — each spec owns its own. */
async function gotoHandoffs(window: import('@playwright/test').Page): Promise<void> {
  await window.getByRole('button', { name: 'Home' }).waitFor({ state: 'visible' });
  await window.getByRole('button', { name: 'Handoffs', exact: true }).click();
}

/**
 * Register a handoff via the panel UI. The first context row is pre-seeded with
 * key `parentTaskId` (Handoffs.tsx:51-53), so only the value needs filling.
 */
async function registerHandoff(
  window: import('@playwright/test').Page,
  sessionId: string,
  parentTaskId: string,
): Promise<void> {
  await window.getByLabel('Agent session id').fill(sessionId);
  // The seeded row's value input — the only `placeholder="value"` on first load.
  await window.getByPlaceholder('value').fill(parentTaskId);
  await window.getByRole('button', { name: 'Register handoff' }).click();
}

test.describe('Handoffs panel', () => {
  test('H-E2E1: register a handoff via the UI', async ({ app }) => {
    const { window } = app;
    await gotoHandoffs(window);

    await registerHandoff(window, 'sess_e2e1', 'o2LOz5FWVIj');

    // The row renders the context as `key=value` text (Handoffs.tsx:225-229).
    await expect(window.getByText('parentTaskId=o2LOz5FWVIj')).toBeVisible();

    // New rows are enabled by default — assert via the per-row switch.
    const toggle = window.getByRole('switch', { name: 'Toggle handoff for sess_e2e1' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  test('H-E2E2: handoff persists across reload', async ({ app }) => {
    await gotoHandoffs(app.window);
    await registerHandoff(app.window, 'sess_e2e2', 'tsk_persist');

    await app.relaunch();
    await gotoHandoffs(app.window);

    await expect(app.window.getByText('parentTaskId=tsk_persist')).toBeVisible();
  });

  test('H-E2E3: toggle enable/disable (and persists across reload)', async ({ app }) => {
    await gotoHandoffs(app.window);
    await registerHandoff(app.window, 'sess_e2e3', 'tsk_toggle');

    // Resolve lazily so it survives relaunch (the pre-relaunch Page goes stale).
    const toggle = () =>
      app.window.getByRole('switch', { name: 'Toggle handoff for sess_e2e3' });

    await toggle().click();
    await expect(toggle()).toHaveAttribute('aria-checked', 'false');

    // Persists across reload.
    await app.relaunch();
    await gotoHandoffs(app.window);
    await expect(toggle()).toHaveAttribute('aria-checked', 'false');
  });

  test('H-E2E4: delete a handoff', async ({ app }) => {
    const { window } = app;
    await gotoHandoffs(window);
    await registerHandoff(window, 'sess_e2e4', 'tsk_delete');

    // Delete is immediate — no confirm dialog on this panel (unlike profiles).
    await window.getByRole('button', { name: 'Delete' }).first().click();

    await expect(window.getByText('parentTaskId=tsk_delete')).toHaveCount(0);
    await expect(window.getByText('No handoffs registered.')).toBeVisible();
  });

  test('H-E2E5: validation feedback on empty session id', async ({ app }) => {
    const { window } = app;
    await gotoHandoffs(window);

    // Leave session id empty; the seeded context row has a key, so the only
    // failing check is the empty session id.
    await window.getByPlaceholder('value').fill('tsk_no_session');
    await window.getByRole('button', { name: 'Register handoff' }).click();

    await expect(window.getByText('Session id is required.')).toBeVisible();

    // Nothing was saved — verify via the preload bridge.
    const list = await window.evaluate(async () => {
      const api = (
        window as unknown as {
          api: { handoffs: { list: () => Promise<unknown[]> } };
        }
      ).api;
      return api.handoffs.list();
    });
    expect(list).toHaveLength(0);
  });
});
