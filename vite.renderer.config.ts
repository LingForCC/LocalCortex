import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // Root = the renderer dir so the dev server serves index.html at `/`.
  root: resolve(__dirname, 'src/renderer'),
  // Tailwind v4 is wired through PostCSS (postcss.config.cjs) rather than the
  // `@tailwindcss/vite` plugin: that plugin is ESM-only and the repo is CJS
  // (no `"type": "module"`), so Forge's Vite plugin can't `require()` the
  // renderer config — the renderer never builds and E2E sees a blank window.
  // `@tailwindcss/postcss` ships a dual CJS/ESM build that loads either way.
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
  build: {
    // Pin outDir to the project-root-relative Forge convention
    // (.vite/renderer/<name>) so the built index.html lands at a stable path
    // regardless of `root`. main.js's `loadFile` branch serves from here when
    // the app is launched outside `electron-forge start` (e.g. by Playwright).
    outDir: resolve(__dirname, '.vite/renderer/main_window'),
    rollupOptions: {
      input: { index: resolve(__dirname, 'src/renderer/index.html') },
    },
  },
});
