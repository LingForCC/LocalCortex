// ESM shim that loads the Node built-in node:sqlite without going through
// Vite's static transform (which mangles the `node:` prefix). Used only by the
// Vitest config alias; production builds externalize node:sqlite normally.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
