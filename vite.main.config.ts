import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Main process build. node:sqlite and electron are Node/Electron built-ins
// that must stay external; everything else (including CJS deps like electron-log)
// is bundled so the ESM output doesn't emit `require()` calls (the project is
// "type": "module", so .js files run as ESM where require is undefined).
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
    },
  },
  build: {
    // electron and node:sqlite are built-ins that must stay external. The
    // preload/main output is CommonJS (Forge's default, and Electron loads
    // preload scripts as CJS).
    rollupOptions: {
      external: ['electron', 'node:sqlite'],
      input: { main: resolve(__dirname, 'src/main/index.ts') },
    },
  },
});
