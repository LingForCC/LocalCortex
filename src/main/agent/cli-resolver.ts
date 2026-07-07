/**
 * CLI path resolver for the Codex and Claude Code backends.
 *
 * Spec: docs/architecture.md §6.5.1 (CLI resolution).
 *
 * By default each backend's SDK spawns a **bundled, vendored** native binary
 * resolved via `require.resolve` against a platform-specific npm package. That
 * means upgrading a globally installed `codex`/`claude` has no effect on this
 * app. To opt into the locally installed CLI instead, the user sets an explicit
 * path in Settings (codexCliPath / claudeCliPath), or leaves it blank to
 * auto-detect the binary on `PATH`.
 *
 * Resolution order (same for both backends):
 *  1. An explicit path from Settings, if set and non-empty.
 *  2. The first executable match found on `process.env.PATH` (`which`-style).
 *  3. `undefined` → caller passes nothing → the SDK falls back to its bundled
 *     binary (current/default behavior).
 *
 * This module is intentionally SDK-free (no imports from either agent SDK) so
 * it can be unit-tested in isolation and stays a sibling utility to the
 * runners, which themselves own the SDK wiring.
 */

import { existsSync, accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * Return the binary name for the current platform, appending `.exe` on Windows.
 * Exported for tests; callers should prefer `resolveOnPath`.
 */
export function platformBinaryName(base: string): string {
  return process.platform === 'win32' ? `${base}.exe` : base;
}

/**
 * `which`-style lookup: return the first directory on `PATH` that contains an
 * executable file named `binaryName`, or `undefined` if none matches.
 *
 * A match must exist AND be executable (X_OK). On platforms without executable
 * bits (Windows), `accessSync(X_OK)` is a no-op pass, which is the correct
 * behavior there.
 */
export function resolveOnPath(binaryName: string, env = process.env): string | undefined {
  const path = env['PATH'];
  if (!path) return undefined;
  for (const dir of path.split(delimiter)) {
    if (!dir) continue; // skip empty segments (e.g. leading/trailing colon)
    const candidate = join(dir, binaryName);
    if (existsSync(candidate)) {
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Exists but not executable — keep scanning PATH.
      }
    }
  }
  return undefined;
}

/**
 * Resolve the path to a locally installed `codex` CLI.
 *
 * @param explicit Optional explicit path from Settings (codexCliPath).
 * @returns Absolute path to the binary, or `undefined` to let the Codex SDK
 *   resolve its bundled vendored binary.
 */
export function resolveCodexPath(explicit?: string): string | undefined {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;
  return resolveOnPath(platformBinaryName('codex'));
}

/**
 * Resolve the path to a locally installed Claude Code (`claude`) CLI.
 *
 * @param explicit Optional explicit path from Settings (claudeCliPath).
 * @returns Absolute path to the binary, or `undefined` to let the Claude Agent
 *   SDK resolve its bundled binary.
 */
export function resolveClaudePath(explicit?: string): string | undefined {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;
  return resolveOnPath(platformBinaryName('claude'));
}

/**
 * Best-effort validation that a path exists and is executable. Used by the
 * Settings IPC handler on save to reject obvious typos before they reach the
 * DB. Returns `true` for the empty string (means "auto-detect / default").
 *
 * Cannot guarantee the binary is the *right* one — runtime errors from the SDK
 * still surface in run history.
 */
export function isExecutablePath(p: string): boolean {
  const trimmed = p.trim();
  if (!trimmed) return true;
  if (!existsSync(trimmed)) return false;
  try {
    accessSync(trimmed, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
