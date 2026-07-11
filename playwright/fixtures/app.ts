/**
 * Playwright test fixtures for launching the LocalCortex Electron app against a
 * fully isolated environment.
 *
 * Tests must NEVER touch the operator's real runtime data:
 *  - the SQLite DB at ~/Library/Application Support/LocalCortex/localcortex.db
 *    (resolved via Electron's `app.getPath('userData')` — src/main/index.ts:77)
 *  - the MCP config + per-run workdirs at ~/.localcortex/ (resolved via
 *    `os.homedir()` — src/main/index.ts:88,115)
 *
 * Isolation needs TWO levers because the two paths resolve the home directory
 * differently on macOS:
 *  - `HOME=<tmpdir>` relocates `~/.localcortex/` (uses `os.homedir()`, which
 *    respects HOME on POSIX/macOS).
 *  - `--user-data-dir=<tmpdir>/userData` relocates the DB (Electron's
 *    `app.getPath('userData')` on macOS is resolved through Cocoa and IGNORES
 *    HOME — only the CLI flag works). This also scopes the single-instance
 *    SingletonLock into the temp dir, so tests don't conflict with any real
 *    LocalCortex the operator may have open.
 *
 * Each test gets a fresh tmpdir; the fixture tears down the app and deletes the
 * tmpdir on cleanup.
 *
 * The ingress HTTP listener binds a fixed port (4729). playwright.config.ts
 * already pins `workers: 1` + `fullyParallel: false`, so only one isolated app
 * runs at a time and the fixture's `app.close()` is sufficient to free the port
 * before the next test launches.
 */

import {
  test as base,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

/** Path to the packaged main bundle (built by `electron-forge` / vite). */
const MAIN_BUNDLE = join(__dirname, '..', '..', '.vite', 'build', 'main.js');

export interface AppFixture {
  /** The running Electron application. */
  electronApp: ElectronApplication;
  /** The first (main) renderer window. */
  window: Page;
  /** The isolated HOME directory backing this run's DB + MCP config. */
  home: string;
  /**
   * Close and re-launch the app against the SAME isolated HOME. Used to assert
   * that state (rules, settings, MCP config) persisted to disk. Updates the
   * `electronApp` / `window` fields in place and awaits the remounted root.
   */
  relaunch: () => Promise<void>;
  /**
   * Complete the handoff onboarding wizard via the UI (select agent → task
   * manager → backend → Finish) so the shell is reachable. A fresh DB shows
   * the wizard before anything else, so specs that test the shell (Rules,
   * Settings, Sources, …) must call this first. Idempotent: if the shell is
   * already showing, it's a no-op.
   *
   * @param opts.agent     Agent id to select (default: the first builtin, 'zcode').
   * @param opts.taskManager Task manager id (default: the first builtin, 'omnifocus').
   * @param opts.backend   Review-rule backend (default: 'claude').
   */
  completeOnboarding: (opts?: {
    agent?: string;
    taskManager?: string;
    backend?: string;
  }) => Promise<void>;
}

/**
 * Internal: launch (or re-launch) the Electron app under the given HOME and
 * return the application + its first window, awaiting the renderer mount.
 *
 * Two isolation levers:
 *  - `HOME=<tmpdir>` relocates `~/.localcortex/` (MCP config + run workdirs),
 *    which the app resolves via `os.homedir()` — this DOES respect HOME.
 *  - `--user-data-dir=<tmpdir>/userData` relocates the SQLite DB, which the app
 *    resolves via Electron's `app.getPath('userData')`. On macOS this path is
 *    computed through Cocoa and IGNORES the HOME env var, so the CLI flag is
 *    required (HOME alone leaks the DB into the real
 *    ~/Library/Application Support/LocalCortex/). The flag also scopes the
 *    single-instance SingletonLock into the temp dir, avoiding lock conflicts
 *    with any concurrently-running LocalCortex.
 */
async function launchApp(
  home: string,
): Promise<{ electronApp: ElectronApplication; window: Page }> {
  const userData = join(home, 'userData');
  const electronApp = await electron.launch({
    args: [MAIN_BUNDLE, `--user-data-dir=${userData}`],
    env: { ...process.env, HOME: home, NODE_ENV: 'development' },
  });
  const window = await electronApp.firstWindow();
  await expect(window.locator('#root')).not.toBeEmpty();
  return { electronApp, window };
}

/**
 * Test fixture: launches the app with an isolated HOME and yields the window.
 * The app is closed and the tmpdir removed on teardown.
 *
 * Use as: `test('...', async ({ app }) => { await app.window.click(...) })`.
 */
export const test = base.extend<{ app: AppFixture }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixture signature requires a destructure even when this fixture has no deps.
  app: async ({}, use) => {
    const home = mkdtempSync(join(tmpdir(), 'lc-e2e-'));
    let { electronApp, window } = await launchApp(home);

    const fixture: AppFixture = {
      get electronApp() {
        return electronApp;
      },
      get window() {
        return window;
      },
      home,
      relaunch: async () => {
        await electronApp.close().catch(() => {});
        const next = await launchApp(home);
        electronApp = next.electronApp;
        window = next.window;
      },
      completeOnboarding: async (opts?: {
        agent?: string;
        taskManager?: string;
        backend?: string;
      }) => {
        const agent = opts?.agent ?? 'zcode';
        const taskManager = opts?.taskManager ?? 'omnifocus';
        const backend = opts?.backend ?? 'Claude';

        // If the shell is already showing (setup complete), do nothing.
        // Detect the wizard by the "Welcome to LocalCortex" heading.
        const isOnboarding = await window
          .getByRole('heading', { name: 'Welcome to LocalCortex' })
          .isVisible()
          .catch(() => false);
        if (!isOnboarding) return;

        // Step 1: pick agent.
        await window.getByRole('radio', { name: new RegExp(`^${agent}$`, 'i') }).click();
        await window.getByRole('button', { name: 'Next' }).click();

        // Step 2: pick task manager.
        await window.getByRole('radio', { name: new RegExp(`^${taskManager}$`, 'i') }).click();
        await window.getByRole('button', { name: 'Next' }).click();

        // Step 3: pick backend (match on the card's aria-label, which is the
        // backend label string, e.g. "Claude (Claude Code SDK)").
        await window.getByRole('radio', { name: new RegExp(`^${backend}`, 'i') }).click();
        await window.getByRole('button', { name: 'Next' }).click();

        // Step 4: review & Finish.
        await window.getByRole('button', { name: 'Finish' }).click();

        // Wait for the shell to fully render: the sidebar appears AND the Home
        // tab content is visible. Waiting only for the sidebar button can race
        // with the React re-render after onboarding completes.
        await expect(window.getByRole('button', { name: 'Home' })).toBeVisible({ timeout: 10_000 });
        await expect(window.getByText('Handoff setup')).toBeVisible({ timeout: 10_000 });
      },
    };

    try {
      await use(fixture);
    } finally {
      await electronApp.close().catch(() => {});
      rmSync(home, { recursive: true, force: true });
    }
  },
});

export { expect };
