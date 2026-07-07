import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Root = the renderer dir so the dev server serves index.html at `/`.
  root: resolve(__dirname, 'src/renderer'),
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
  build: {
    rollupOptions: {
      input: { index: resolve(__dirname, 'src/renderer/index.html') },
    },
  },
});
