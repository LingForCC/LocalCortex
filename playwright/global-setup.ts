/**
 * Playwright globalSetup: ensures the app is built before E2E runs.
 *
 * Why this exists: E2E launches `.vite/build/main.js` directly (not via
 * `electron-forge start`), so `MAIN_WINDOW_VITE_DEV_SERVER_URL` is undefined and
 * `createWindow()` serves the built renderer via `loadFile`. That file must
 * exist, or every test sees a blank window and times out on `#root`.
 *
 * `electron-forge package` builds main + preload + renderer into `.vite/`.
 * We run it once up front (rather than the full `make`/DMG) so `test:e2e` is
 * self-contained — no need to remember a manual build step.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const RENDERER_INDEX = join(__dirname, '..', '.vite', 'renderer', 'main_window', 'index.html');

export default async function globalSetup(): Promise<void> {
  // Build always — source may have changed since the last build. Forge's Vite
  // plugin is incremental and fast on a no-op rebuild.
  execSync('npm run package', { stdio: 'inherit' });

  if (!existsSync(RENDERER_INDEX)) {
    throw new Error(
      `E2E globalSetup: expected built renderer at ${RENDERER_INDEX} after \`npm run package\`, ` +
        'but it is missing. Check vite.renderer.config.ts build.outDir.',
    );
  }
}
