/**
 * MCP server lifecycle manager.
 *
 * Spec: docs/architecture.md §5.4 (respawn per run), docs/tech-stack.md §6.2
 * (subprocess lifecycle). Every agent run spawns the MCP servers it needs;
 * they die when the run ends. Per-run isolation eliminates zombie servers,
 * stale connections, and pool exhaustion.
 *
 * In this design the actual subprocess spawning is done by the agent SDKs
 * (both Claude's `options.mcpServers` and Codex's `.codex/config.toml` spawn
 * stdio child processes internally). This module is the app-level accounting
 * layer: it tracks spawned PIDs/processes observed during a run and ensures
 * they're killed on teardown or app quit — defense-in-depth against leaks.
 */

import { logger } from '../observability/logger.js';

/** A registered tracked process. */
interface TrackedChild {
  pid?: number;
  kill: (signal?: NodeJS.Signals) => void;
  name: string;
}

/**
 * Tracks spawned subprocesses for a single run (or app-wide) and kills them
 * all on `teardown()`.
 */
export class LifecycleManager {
  private readonly children: TrackedChild[] = [];

  /** Track a spawned child process so it can be killed on teardown. */
  track(name: string, child: { pid?: number; kill: (signal?: NodeJS.Signals) => void }): void {
    this.children.push({ pid: child.pid, kill: (s) => child.kill(s), name });
    if (child.pid) logger.debug(`lifecycle: tracking ${name} (pid ${child.pid})`);
  }

  /** Currently tracked PIDs (for diagnostics). */
  get trackedPids(): number[] {
    return this.children.map((c) => c.pid).filter((p): p is number => typeof p === 'number');
  }

  /**
   * Kill every tracked child. Called on run teardown and app quit
   * (architecture.md §6.2, §8; tech-stack.md §6.5).
   */
  teardown(signal: NodeJS.Signals = 'SIGTERM'): void {
    for (const child of this.children) {
      try {
        child.kill(signal);
      } catch (e) {
        logger.warn(`lifecycle: failed to kill ${child.name}: ${(e as Error).message}`);
      }
    }
    this.children.length = 0;
  }
}
