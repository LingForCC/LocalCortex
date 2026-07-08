/**
 * E2E for Settings (docs/features/settings/test-plan.md — fills a gap: the plan
 * lists only manual cases, but global-settings persistence and schema rejection
 * are pure UI + IPC and worth automating).
 *
 * Covers:
 *  - Persistence: edit tick interval + concurrency → Save → relaunch → restored.
 *  - Schema rejection: tick < 300 is rejected by UpdateSettingsMessageSchema, so
 *    the value does not persist.
 */

import { test, expect } from './fixtures/app';
import { DEFAULT_TICK_INTERVAL_SECONDS, DEFAULT_CONCURRENCY } from '@shared/constants';

/** Click a sidebar nav button by its label. */
async function gotoTab(window: import('@playwright/test').Page, label: string): Promise<void> {
  await window.getByRole('button', { name: label }).click();
}

test.describe('Global settings', () => {
  test('changing tick interval + concurrency persists across reload', async ({ app }) => {
    await gotoTab(app.window, 'Settings');

    const tick = app.window.getByLabel('Default tick interval (seconds, ≥ 300)');
    const concurrency = app.window.getByLabel('Concurrency cap');

    // Sanity: defaults are loaded first.
    await expect(tick).toHaveValue(String(DEFAULT_TICK_INTERVAL_SECONDS));
    await expect(concurrency).toHaveValue(String(DEFAULT_CONCURRENCY));

    await tick.fill('600');
    await concurrency.fill('5');
    await app.window.getByRole('button', { name: 'Save' }).click();

    // Relaunch and confirm both values were restored from the DB. app.window is
    // rebound by relaunch(), so re-resolve the inputs off the new page.
    await app.relaunch();
    await gotoTab(app.window, 'Settings');
    await expect(app.window.getByLabel('Default tick interval (seconds, ≥ 300)')).toHaveValue(
      '600',
    );
    await expect(app.window.getByLabel('Concurrency cap')).toHaveValue('5');
  });

  test('tick interval below the 300s floor is rejected and does not persist', async ({ app }) => {
    await gotoTab(app.window, 'Settings');

    const tick = app.window.getByLabel('Default tick interval (seconds, ≥ 300)');
    await tick.fill('100'); // below the MIN_TICK_INTERVAL_SECONDS floor
    await app.window.getByRole('button', { name: 'Save' }).click();

    // The IPC handler throws on schema failure, so the value never reaches the
    // DB. Relaunch and confirm the default is still in place.
    await app.relaunch();
    await gotoTab(app.window, 'Settings');
    await expect(app.window.getByLabel('Default tick interval (seconds, ≥ 300)')).toHaveValue(
      String(DEFAULT_TICK_INTERVAL_SECONDS),
    );
  });
});

test.describe('Appearance', () => {
  test('changing appearance persists across reload', async ({ app }) => {
    await gotoTab(app.window, 'Settings');

    const appearance = app.window.getByLabel('Appearance');
    // Sanity: the default is 'system'.
    await expect(appearance).toHaveValue('system');

    await appearance.selectOption('dark');
    await app.window.getByRole('button', { name: 'Save' }).click();

    // Relaunch and confirm the choice was restored from the DB.
    await app.relaunch();
    await gotoTab(app.window, 'Settings');
    await expect(app.window.getByLabel('Appearance')).toHaveValue('dark');
  });

  test('selecting dark applies the dark color scheme immediately', async ({ app }) => {
    await gotoTab(app.window, 'Settings');

    const appearance = app.window.getByLabel('Appearance');
    await appearance.selectOption('dark');
    await app.window.getByRole('button', { name: 'Save' }).click();

    // The main process should drive nativeTheme to 'dark' and Chromium should
    // render the dark background token (hsl(222.2 47.4% 11.2%) = rgb(15,23,42))
    // from the prefers-color-scheme: dark block in styles.css. Both propagation
    // and the CSS recompute are async, so poll until they agree.
    await expect
      .poll(async () => {
        const themeSource = await app.electronApp.evaluate(
          ({ nativeTheme }) => nativeTheme.themeSource,
        );
        const bg = await app.window.evaluate(
          () => getComputedStyle(document.body).backgroundColor,
        );
        return { themeSource, bg };
      })
      .toEqual({ themeSource: 'dark', bg: 'rgb(15, 23, 42)' });

    // Switch back to light and confirm the window flips too (no restart):
    // light background token is hsl(0 0% 100%) = rgb(255, 255, 255).
    await appearance.selectOption('light');
    await app.window.getByRole('button', { name: 'Save' }).click();
    await expect
      .poll(async () => {
        const themeSource = await app.electronApp.evaluate(
          ({ nativeTheme }) => nativeTheme.themeSource,
        );
        const bg = await app.window.evaluate(
          () => getComputedStyle(document.body).backgroundColor,
        );
        return { themeSource, bg };
      })
      .toEqual({ themeSource: 'light', bg: 'rgb(255, 255, 255)' });
  });
});
