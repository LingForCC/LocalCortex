/**
 * Type augmentation so the renderer sees `window.api` as the typed bridge.
 * The actual exposure is done in src/main/preload.ts via contextBridge.
 */
import type { LocalCortexApi } from '@main/preload';

declare global {
  interface Window {
    api: LocalCortexApi;
  }
}

export {};
