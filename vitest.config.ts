import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
      // Vite's optimizer strips the `node:` prefix and then fails to resolve
      // `sqlite`. Alias the (stripped) bare specifier to a tiny ESM shim that
      // re-exports the built-in module via createRequire — this keeps node:sqlite
      // out of Vite's transform pipeline entirely.
      sqlite: resolve(__dirname, 'vitest-shims/node-sqlite.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
