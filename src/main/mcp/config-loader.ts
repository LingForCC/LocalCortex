/**
 * Loads and parses the user-editable ~/.localcortex/mcp-servers.json.
 *
 * Spec: docs/mcp-servers.md §1-§3. The file is the single source of truth for
 * server definitions. On first launch (when the file doesn't exist), the app
 * writes the bundled default (default-config.ts) with 0600 permissions
 * (mcp-servers.md §8 security note).
 *
 * The pure parse logic (`parseConfigFile`) is separated from the I/O so it can
 * be unit-tested directly. `loadMcpServersFile` does the filesystem read and is
 * thin.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { McpServersFileSchema } from '@shared/schemas/mcp-config-schema';
import type { McpServersFile } from '@shared/types';
import { buildDefaultConfig } from './default-config.js';

/** Parse raw file text into a validated McpServersFile. Throws on invalid JSON/schema. */
export function parseConfigFile(raw: string): McpServersFile {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`mcp-servers.json is not valid JSON: ${(e as Error).message}`);
  }
  return McpServersFileSchema.parse(json);
}

/** Serialize a config object back to pretty JSON. */
export function serializeConfigFile(config: McpServersFile): string {
  return JSON.stringify(config, null, 2) + '\n';
}

/**
 * Load and validate the config file at `path`. Returns null if it does not exist.
 */
export function loadMcpServersFile(path: string): McpServersFile | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  return parseConfigFile(raw);
}

export interface EnsureConfigResult {
  config: McpServersFile;
  created: boolean;
  path: string;
}

/**
 * Ensure a config file exists at `path`; if missing, write the bundled default
 * using 0600 permissions. Returns the loaded config + whether it was just
 * created.
 *
 * Callers pass `path` explicitly so the function is testable without Electron's
 * `app.getPath`. The main process computes the real `~/.localcortex/...` path.
 */
export function ensureConfigFile(path: string): EnsureConfigResult {
  const existing = loadMcpServersFile(path);
  if (existing) return { config: existing, created: false, path };

  const config = buildDefaultConfig();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, serializeConfigFile(config), { encoding: 'utf8', mode: 0o600 });
  // writeFileSync `mode` is masked by umask; enforce 0600 explicitly.
  try {
    chmodSync(path, 0o600);
  } catch {
    // chmod best-effort (e.g. on some filesystems); the write mode is already restrictive.
  }
  return { config, created: true, path };
}
