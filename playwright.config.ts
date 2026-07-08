import { defineConfig } from '@playwright/test';

/**
 * Playwright E2E config for the Electron app.
 *
 * Tests launch the real packaged app via `_electron.launch()` and drive it
 * with Playwright's Electron API. See playwright/e2e.spec.ts.
 *
 * NOTE: E2E is not run as part of the default `npm test` (Vitest) gate —
 * run it explicitly with `npm run test:e2e`. It requires the app to be
 * packaged (`npm run package`) or available at the dev path.
 */
export default defineConfig({
  testDir: './playwright',
  // Build the app (main + preload + renderer into .vite/) once before tests, so
  // launching .vite/build/main.js directly has a renderer to loadFile. Without
  // this, every test sees a blank window (MAIN_WINDOW_VITE_DEV_SERVER_URL is
  // undefined outside `electron-forge start`). See playwright/global-setup.ts.
  globalSetup: './playwright/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
  },
});
