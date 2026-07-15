import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseVersion, FuseV1Options } from '@electron/fuses';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { readdirSync, statSync } from 'node:fs';

/**
 * Collect every `.app` bundle produced by packaging. `postPackage`'s
 * `outputPaths` can be either the bundle itself (when a single arch is built)
 * or the parent dir holding it (e.g. `out/LocalCortex-darwin-arm64/`), so we
 * handle both and recurse one level.
 */
function appBundlesIn(paths: string[]): string[] {
  const apps: string[] = [];
  for (const p of paths) {
    let stat;
    try {
      stat = statSync(p);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(p)) {
        if (entry.endsWith('.app')) apps.push(join(p, entry));
      }
    } else if (p.endsWith('.app')) {
      apps.push(p);
    }
  }
  return apps;
}

/**
 * Re-stamp a valid ad-hoc signature on the packaged macOS .app.
 *
 * This is a workaround for electron/forge#3757: the FusesPlugin flips fuse bits
 * in the Electron binary at `packageAfterCopy` and re-signs ad-hoc, but
 * @electron/packager then writes ElectronAsarIntegrity into Info.plist *after*
 * that — invalidating the fuses signature (`invalid Info.plist (plist or
 * signature have been modified)`). A broken signature isn't just cosmetic: macOS
 * TCC refuses to attribute Apple Events (Automation) sends to an app whose
 * signature won't verify, so it never shows the permission prompt and never
 * lists the app under System Settings → Privacy & Security → Automation. That is
 * why MCP servers driving OmniFocus/Todoist via Apple Events silently fail in
 * the packaged app while working fine in dev.
 *
 * Re-signing the final bundle here — after packager has finalized the plist —
 * produces a signature that verifies, so TCC can attribute and prompt. This is
 * ad-hoc (no Developer ID), which is correct for local/personal builds; a real
 * distribution would use `osxSign` + notarization instead.
 */
const config: ForgeConfig = {
  hooks: {
    postPackage: async (_forgeConfig, packageResult) => {
      if (packageResult.platform !== 'darwin') return;
      const apps = appBundlesIn(packageResult.outputPaths);
      for (const appPath of apps) {
        const res = spawnSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
          stdio: 'inherit',
        });
        if (res.status !== 0) {
          throw new Error(`postPackage ad-hoc re-sign failed for ${appPath} (exit ${res.status})`);
        }
      }
    },
  },

  packagerConfig: {
    name: 'LocalCortex',
    executableName: 'LocalCortex',
    // App icon (committed under assets/icon/, NOT build/ which is gitignored).
    // @electron/packager accepts a base path without extension and picks the
    // right file per platform: icon.icns (macOS), icon.ico (Windows), PNGs
    // (Linux). Only macOS (maker-dmg) is wired up right now.
    icon: 'assets/icon/icon',
    asar: true,
    // node:sqlite is a built-in module — no native rebuild, no asarUnpack needed.
    // MCP servers like omnifocus-mcp drive their target app via Apple Events.
    // macOS requires NSAppleEventsUsageDescription in Info.plist to even prompt
    // for Automation permission; without it the send is silently blocked (the
    // "OmniFocus Apple Events authorization failed" run error). Added here so
    // the bundled .app can talk to OmniFocus / Todoist / etc.
    extendInfo: {
      NSAppleEventsUsageDescription:
        'LocalCortex runs rules that route updates to task managers (OmniFocus, Todoist) via Apple Events through MCP servers.',
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-dmg',
      config: {
        format: 'ULFO',
        name: 'LocalCortex',
      },
    },
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/main/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
