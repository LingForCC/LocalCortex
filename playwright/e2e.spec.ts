import { test, expect, _electron as electron } from '@playwright/test';
import { join } from 'node:path';

/**
 * E2E smoke test: launches the real Electron app and verifies it boots + shows
 * the renderer. Per docs/tech-stack.md §5, real agent reasoning is not
 * automated; this test only checks the app shell launches.
 *
 * Run with: npm run test:e2e (requires the app to be runnable via electron-forge).
 */
test.describe('LocalCortex app launch', () => {
  test('boots and shows the main window', async () => {
    const app = await electron.launch({
      args: [join(__dirname, '..', '.vite', 'build', 'main.js')],
      env: { ...process.env, NODE_ENV: 'development' },
    });

    const window = await app.firstWindow();
    await expect(window).toHaveTitle(/LocalCortex/i);

    // The renderer root should mount.
    await expect(window.locator('#root')).not.toBeEmpty();

    await app.close();
  });
});
