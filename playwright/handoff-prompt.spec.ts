/**
 * E2E for the prompt-submit handoff popup
 * (docs/features/handoffs/test-plan.md H-E2E6..H-E2E9).
 *
 * The popup is a separate Electron BrowserWindow (loaded via
 * `?view=handoff-prompt`) that opens when the ingress receives a
 * `*.prompt-submit` event carrying a `payload.sessionId`. There is no in-app
 * button that opens it — it is driven entirely by POSTing an event to the
 * loopback ingress.
 *
 * Flow: HTTP POST /event → ingress `onEvent` observer → buildPromptSubmitPrompt
 * → openHandoffPopup (one window per sessionId; re-focus on repeat). The popup
 * loads HandoffPrompt.tsx, which branches on `payload.mode` ('new' attach form
 * vs 'existing' enable/disable toggle).
 *
 * Uses the shared fixture (isolated HOME + fresh DB per test, no ingress
 * secret configured by default — so no `x-localcortex-secret` header needed).
 */

import { test, expect } from './fixtures/app';
import type { Page, ElectronApplication } from '@playwright/test';

const INGRESS_URL = 'http://127.0.0.1:4729';

/** POST an event to the ingress; returns { status, body }. Mirrors triggers.spec.ts. */
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

/** POST a `zcode.prompt-submit` event for the given session id. */
async function postPromptSubmit(sessionId: string): Promise<void> {
  const { status } = await postEvent({
    type: 'zcode.prompt-submit',
    timestamp: new Date().toISOString(),
    payload: { sessionId },
  });
  expect(status).toBe(200);
}

/**
 * Wait for and return the prompt-submit popup window. Must be set up BEFORE the
 * triggering postEvent (Playwright resolves `waitForEvent('window')` against a
 * future window-open event). The popup loads HandoffPrompt.tsx, which renders a
 * "Loading…" placeholder until the payload IPC arrives — so callers should wait
 * for popup-specific content, not #root.
 */
async function waitForPopup(app: { electronApp: ElectronApplication }): Promise<Page> {
  return app.electronApp.waitForEvent('window');
}

/** Create a handoff via the preload bridge (seeds existing-session mode). */
async function createHandoffViaApi(
  window: Page,
  sessionId: string,
  parentTaskId: string,
): Promise<void> {
  await window.evaluate(async ({ sessionId, parentTaskId }: { sessionId: string; parentTaskId: string }) => {
    const api = (
      window as unknown as {
        api: {
          handoffs: {
            create: (input: {
              sessionId: string;
              context: Record<string, string>;
            }) => Promise<unknown>;
          };
        };
      }
    ).api;
    await api.handoffs.create({ sessionId, context: { parentTaskId } });
  }, { sessionId, parentTaskId });
}

test.describe('Prompt-submit handoff popup', () => {
  test('H-E2E6: popup opens for a new (unknown) session', async ({ app }) => {
    // Start listening before the event fires the popup.
    const popupPromise = waitForPopup(app);
    await postPromptSubmit('sess_new');

    const popup = await popupPromise;
    // New-mode title: "<source> session handoff" → zcode.prompt-submit ⇒ "zcode".
    await expect(popup.getByText('zcode session handoff')).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Attach handoff' })).toBeVisible();

    // Session id is pre-filled (read-only) from the event payload. The value
    // lives in the input's value attribute, not text content — assert via
    // toHaveValue on the read-only input.
    await expect(popup.locator('input[readonly]')).toHaveValue('sess_new');
  });

  test('H-E2E7: popup opens in existing-session mode for a known session', async ({ app }) => {
    const { window } = app;
    // Seed a handoff so findBySessionId matches (enabled OR disabled).
    await createHandoffViaApi(window, 'sess_existing', 'tsk1');

    const popupPromise = waitForPopup(app);
    await postPromptSubmit('sess_existing');

    const popup = await popupPromise;
    // Existing-mode title.
    await expect(popup.getByText('Session resumed')).toBeVisible();
    await expect(popup.getByRole('switch', { name: 'Toggle handoff' })).toBeVisible();
  });

  test('H-E2E8: attaching from the popup syncs to the main Handoffs panel', async ({ app }) => {
    const { window } = app;
    // The main panel must be on the Handoffs tab for its `onChanged`
    // subscription (Handoffs.tsx:63-66) to be mounted.
    await window.getByRole('button', { name: 'Handoffs', exact: true }).click();

    const popupPromise = waitForPopup(app);
    await postPromptSubmit('sess_sync');
    const popup = await popupPromise;
    await expect(popup.getByText('zcode session handoff')).toBeVisible();

    // Fill the seeded `parentTaskId` row's value and attach.
    await popup.getByPlaceholder('value').fill('tsk_synced');
    await popup.getByRole('button', { name: 'Attach handoff' }).click();

    // The popup self-closes on success. The `handoffs:changed` broadcast fires
    // (ipc/handoffs.ts), and the main panel re-loads — assert without a manual
    // reload.
    await expect(window.getByText('parentTaskId=tsk_synced')).toBeVisible();
  });

  test('H-E2E9: one popup per session — repeat event re-focuses, no second window', async ({
    app,
  }) => {
    const popupPromise = waitForPopup(app);
    await postPromptSubmit('sess_once');
    await popupPromise;

    // main + popup = 2 windows.
    expect(app.electronApp.windows()).toHaveLength(2);

    // A second event for the same session re-focuses the existing window
    // (index.ts openHandoffPrompt returns early) — no new BrowserWindow.
    await postPromptSubmit('sess_once');
    // Safety margin: give a would-be new window time to open before asserting
    // it didn't.
    await app.window.waitForTimeout(500);
    expect(app.electronApp.windows()).toHaveLength(2);
  });
});
