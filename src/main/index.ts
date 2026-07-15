/**
 * Electron main process bootstrap.
 *
 * Spec: docs/architecture.md §4 (main/index.ts), §7; docs/tech-stack.md §6.5
 * (app quit during a run).
 *
 * Wires together: SQLite (node:sqlite) + migrations, the MCP config file,
 * repositories, agent runner providers, the per-rule scheduler (tick rules),
 * the event ingress (event rules), the IPC handlers, and the BrowserWindow.
 * On `before-quit`, signals in-flight runs to abort and tears down subprocesses.
 */

import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import { join } from 'node:path';
import { homedir } from 'node:os';
// Restores the user's login-shell PATH so the packaged app can resolve CLIs
// (codex/claude) that live in shell-configured dirs (e.g. /opt/homebrew/bin,
// ~/.local/bin). GUI-launched apps on macOS inherit a minimal system PATH that
// omits those; in dev `npm start` inherits the terminal PATH so this is a no-op
// there. Lazy-imported so pure modules that import this file stay unit-testable.
import fixPath from 'fix-path';
import { openDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { RulesRepository } from './db/repositories/rules.js';
import { RunsRepository } from './db/repositories/runs.js';
import { HandoffsRepository } from './db/repositories/handoffs.js';
import { HandoffProfilesRepository } from './db/repositories/handoff-profiles.js';
import { SettingsRepository } from './db/repositories/settings.js';
import { McpServersRepository } from './db/repositories/mcp-servers.js';
import { AgentsRepository } from './db/repositories/agents.js';
import { TaskManagersRepository } from './db/repositories/task-managers.js';
import { Scheduler } from './scheduler/scheduler.js';
import { ConcurrencyQueue } from './scheduler/concurrency.js';
import { startIngress } from './events/ingress.js';
import { prepareHandoffEnrichment } from './events/handoff-enrichment.js';
import {
  buildPromptSubmitPrompt,
  collectPromptSubmitEventTypes,
  isPromptSubmitEvent,
} from './events/prompt-submit.js';
import type { HandoffPromptPayload } from '@shared/schemas/ipc-schema';
import { executeRun, type RunnerProvider } from './agent/run-loop.js';
import { ClaudeAgentRunner } from './agent/claude.js';
import { CodexAgentRunner } from './agent/codex.js';
import { resolveCodexPath, resolveClaudePath } from './agent/cli-resolver.js';
import { registerRulesIpc } from './ipc/rules.js';
import { registerRunsIpc } from './ipc/runs.js';
import { registerHandoffsIpc } from './ipc/handoffs.js';
import { registerServersIpc } from './ipc/servers.js';
import { registerSettingsIpc } from './ipc/settings.js';
import { registerCatalogIpc } from './ipc/catalog.js';
import { registerHandoffProfilesIpc } from './ipc/handoff-profiles.js';
import { IPC } from '@shared/schemas/ipc-schema';
import { LifecycleManager } from './mcp/lifecycle.js';
import { logger, logError } from './observability/logger.js';
import {
  APP_DATA_DIRNAME,
  MCP_SERVERS_FILENAME,
  RUNS_SUBDIR,
  DB_FILENAME,
} from '@shared/constants';
import type { AppSettings } from '@shared/types';
import type { FastifyInstance } from 'fastify';

/**
 * Globals statically defined by @electron-forge/plugin-vite (via Vite `define`)
 * at build time. `MAIN_WINDOW_VITE_DEV_SERVER_URL` is the renderer dev-server
 * URL in dev (`electron-forge start`) and `undefined` in the packaged build.
 * The renderer name (`main_window` in forge.config.ts) drives the screaming-
 * snake prefix.
 */
declare global {
  var MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
}

// Module-scoped handles so we can tear them down on quit.
let mainWindow: BrowserWindow | null = null;
let scheduler: Scheduler | null = null;
let ingressServer: FastifyInstance | null = null;
const lifecycle = new LifecycleManager();
const inFlightAborts = new Set<AbortController>();

/**
 * Open handoff-attach popup windows, keyed by sessionId. At most one popup per
 * session: a second prompt-submit for an already-open popup re-focuses it and
 * re-pushes the (possibly changed) payload instead of stacking another window.
 */
const promptWindows = new Map<string, BrowserWindow>();

/**
 * Push the effective dark-mode state (`nativeTheme.shouldUseDarkColors`) to the
 * renderer, which toggles the `.dark` class the theme tokens key off of. We
 * transmit the *effective* state rather than the raw setting so `system` mode
 * resolves correctly (dark-or-light depends on the OS).
 */
function pushThemeToRenderer(): void {
  const dark = nativeTheme.shouldUseDarkColors;
  // `mainWindow` is reset to `null` in `createWindow`'s `closed` handler, but a
  // destroyed window can still be non-null in edge cases — guard explicitly so a
  // `.send` on a stale handle never throws "Object has been destroyed".
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.THEME_APPLY, dark);
}

/**
 * Apply the persisted appearance setting to Electron's `nativeTheme` and notify
 * the renderer of the effective dark-mode state. Call once on bootstrap and
 * again whenever Settings changes. `system` follows the OS preference; the
 * `nativeTheme.on('updated')` listener (registered in bootstrap) covers OS
 * changes while in `system` mode.
 */
function applyAppearance(appearance: AppSettings['appearance']): void {
  nativeTheme.themeSource = appearance;
  pushThemeToRenderer();
}

/**
 * Build a RunnerProvider that resolves each backend's CLI binary fresh per
 * call from the latest settings (arch §6.5.1). Reading settings on each run
 * (rather than once at bootstrap) means a Settings change to codexCliPath /
 * claudeCliPath takes effect on the next run with no app restart. Constructing
 * the runner instances is cheap; the SDK doesn't spawn until `run()` is called.
 */
function buildRunnerProvider(getSettings: () => AppSettings): RunnerProvider {
  return (backend) => {
    const settings = getSettings();
    if (backend === 'claude') {
      return new ClaudeAgentRunner({
        pathToClaudeCodeExecutable: resolveClaudePath(settings.claudeCliPath),
      });
    }
    return new CodexAgentRunner({
      codexPathOverride: resolveCodexPath(settings.codexCliPath),
      // App-level Codex defaults — overridden per-run when a rule sets its own.
      model: settings.codexModel,
      reasoningEffort: settings.codexReasoningEffort,
    });
  };
}

async function bootstrap(): Promise<void> {
  // 0. Restore the login-shell PATH BEFORE anything reads process.env.PATH
  //    (cli-resolver auto-detects codex/claude from it). GUI-launched apps on
  //    macOS inherit a stripped PATH missing Homebrew / ~/.local/bin, so the
  //    agent backends can't spawn from the packaged app without this.
  fixPath();
  // Self-diagnosing check: log the restored PATH and whether each CLI actually
  // resolved. This is the single line to grep after a packaged launch to confirm
  // the fix is working (and to see *which* binary the run will use).
  const codexBin = resolveCodexPath();
  const claudeBin = resolveClaudePath();
  logger.info(
    `PATH restored: ${process.env.PATH ?? '<unset>'} | codex=${codexBin ?? 'NOT FOUND'} | claude=${claudeBin ?? 'NOT FOUND'}`,
  );

  // 1. DB + migrations.
  const dbPath = join(app.getPath('userData'), DB_FILENAME);
  const db = openDatabase(dbPath);
  const migrationResult = runMigrations(db);
  logger.info(`DB migrated: ${JSON.stringify(migrationResult)}`);

  const rulesRepo = new RulesRepository(db);
  const runsRepo = new RunsRepository(db);
  const handoffsRepo = new HandoffsRepository(db);
  const handoffProfilesRepo = new HandoffProfilesRepository(db);
  const settingsRepo = new SettingsRepository(db);
  const mcpServersRepo = new McpServersRepository(db);
  const agentsRepo = new AgentsRepository(db);
  const taskManagersRepo = new TaskManagersRepository(db);
  const settings = settingsRepo.get();

  // Apply the persisted color scheme before the window mounts so there's no
  // flash of the wrong theme.
  applyAppearance(settings.appearance);

  // 2. MCP servers: one-time import from the legacy mcp-servers.json file if it
  //    still exists (idempotent by name). The DB is now the single source of
  //    truth; the file is retired. Seeds were inserted by migration 004.
  const appDataRoot = join(homedir(), APP_DATA_DIRNAME);
  const legacyConfigPath = join(appDataRoot, MCP_SERVERS_FILENAME);
  const imported = mcpServersRepo.importFromFile(legacyConfigPath);
  if (imported > 0) {
    logger.info(`Imported ${imported} MCP server(s) from legacy mcp-servers.json`);
  }

  // 3. Concurrency queue (shared by scheduler + ingress).
  //    Wire onStart so each run's start (and the current backlog) hits the
  //    file log — the only live "is it running?" signal available today, since
  //    runs are otherwise recorded only at completion.
  const queue = new ConcurrencyQueue({
    concurrency: settings.concurrency,
    onStart: ({ running, queued }) => {
      logger.info(`run starting (running=${running}, queued=${queued})`);
    },
  });

  // 4. Runner provider + a manual/tick/event enqueue path.
  //    Pass a getter (not a snapshot) so settings changes apply to the next
  //    run without an app restart (arch §6.5.1).
  const runnerProvider = buildRunnerProvider(() => settingsRepo.get());

  const enqueueRun = async (
    ruleId: string,
    trigger: 'tick' | 'event' | 'manual',
    event?: Parameters<typeof executeRun>[1]['event'],
  ): Promise<number> => {
    const ac = new AbortController();
    inFlightAborts.add(ac);
    return queue.add(async () => {
      try {
        const mcpConfig = mcpServersRepo.getAsConfig();
        return executeRun(
          {
            rulesRepo,
            runsRepo,
            mcpConfig,
            runnerProvider,
            appDataRoot: join(appDataRoot, RUNS_SUBDIR),
            trigger,
          },
          { ruleId, event },
        );
      } finally {
        inFlightAborts.delete(ac);
      }
    });
  };

  // 5. Scheduler (tick rules only).
  scheduler = new Scheduler({
    onTick: (ruleId) => {
      // Fire-and-forget; errors are recorded by the run-loop.
      enqueueRun(ruleId, 'tick').catch((e) => logError(`scheduler tick failed for ${ruleId}`, e));
    },
  });
  scheduler.rescheduleAll(rulesRepo.list(), settings.tickIntervalSeconds);

  // 6. Event ingress (event rules).
  ingressServer = await startIngress({
    port: 4729,
    // Events fired by the hook plugin in LocalCortex's OWN fulfillment runs
    // (Codex/Claude) carry a workdir under the run-staging root. Dropping them
    // here prevents the feedback loop: run → session-complete → matches a
    // handoff rule → run → … Must match resolveCwd()'s layout
    // (join(scratchRoot, 'work', rule.id)).
    selfEventWorkdirPrefix: join(appDataRoot, RUNS_SUBDIR, 'work'),
    getRules: () => rulesRepo.list().filter((r) => r.enabled),
    // Side-effect-only observer: opens the handoff-attach popup for prompt-
    // submit events whose type is the promptSubmitEventType of an agent
    // referenced by an ENABLED handoff profile (independent of whether any rule
    // matches). The allowed set is rebuilt per event from the catalog + profiles
    // so a newly created/enabled profile takes effect without restart. Isolated
    // in a try/catch inside the ingress so a popup failure never blocks the HTTP
    // reply or the match/enqueue path.
    onEvent: (event) => {
      const allowed = collectPromptSubmitEventTypes(
        handoffProfilesRepo.list(),
        agentsRepo.list(),
      );
      if (!isPromptSubmitEvent(event.type, allowed)) return;
      try {
        const payload = buildPromptSubmitPrompt(event, handoffsRepo);
        if (payload) openHandoffPrompt(payload);
      } catch (e) {
        logError('prompt-submit popup failed', e);
      }
    },
    onMatched: async (event, matched) => {
      // Handoff enrichment: if this event carries a sessionId with an enabled
      // handoff registered, merge that handoff's opaque context into the event
      // payload so the fulfilling rule can render {{key}} template variables
      // (e.g. {{parentTaskId}}). An enabled handoff fires on EVERY matching
      // event (so a multi-round session creates the reminder each round); there
      // is no fulfilled state, so nothing to mark afterwards.
      const {
        event: enrichedEvent,
        matched: handoffMatched,
        enrichment,
      } = prepareHandoffEnrichment(event, handoffsRepo);
      // Log the enrichment result so the merged context (the {{key}} vars the
      // fulfilling rule will render) is visible in the log.
      if (enrichment) {
        const sessionId = event.payload['sessionId'];
        const sessionIdStr = typeof sessionId === 'string' ? sessionId : '';
        logger.info(
          `handoff matched: handoffId=${enrichment.handoffId} sessionId=${sessionIdStr} context=${JSON.stringify(enrichment.context)}`,
        );
      }

      for (const rule of matched) {
        enqueueRun(rule.id, 'event', enrichedEvent)
          .then((runId) => {
            if (handoffMatched) {
              logger.info(`handoff enriched run #${runId} (rule=${rule.id})`);
            }
          })
          .catch((e) => logError(`event run failed for ${rule.id}`, e));
      }
    },
    ...(settings.ingressSecret ? { sharedSecret: settings.ingressSecret } : {}),
  });

  // 7. IPC handlers.
  registerRulesIpc(rulesRepo);
  // Broadcast handoff mutations to the main window so its Handoffs list refreshes
  // regardless of where the change originated (main panel vs. prompt-submit popup).
  // Guard against a destroyed main window: the popup may persist after the main
  // window is closed on macOS, and a `.send` on a stale handle throws
  // "Object has been destroyed", which would reject the `handoffs:create` IPC.
  registerHandoffsIpc(handoffsRepo, () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.HANDOFFS_CHANGED);
  });
  registerRunsIpc(runsRepo, (ruleId, eventPayload) =>
    enqueueRun(
      ruleId,
      'manual',
      eventPayload
        ? { type: 'manual', timestamp: new Date().toISOString(), payload: eventPayload }
        : undefined,
    ),
  );
  registerServersIpc({ mcpServersRepo, getRules: () => rulesRepo.list() });
  registerCatalogIpc({ agentsRepo, taskManagersRepo, mcpServersRepo });
  registerHandoffProfilesIpc({
    handoffProfilesRepo,
    agentsRepo,
    taskManagersRepo,
    rulesRepo,
    mcpServersRepo,
    onRulesChanged: () =>
      scheduler?.rescheduleAll(rulesRepo.list(), settingsRepo.get().tickIntervalSeconds),
  });
  // Re-apply the theme (and any future side-effecting setting) on change so a
  // Settings edit takes effect immediately, with no restart.
  registerSettingsIpc(settingsRepo, (updated) => applyAppearance(updated.appearance));

  // In `system` mode the effective scheme can flip under us when the OS theme
  // changes; re-push the effective state so the renderer follows it.
  nativeTheme.on('updated', pushThemeToRenderer);

  // Re-schedule on rule changes.
  ipcMain.on('rules:changed', () => {
    scheduler?.rescheduleAll(rulesRepo.list(), settingsRepo.get().tickIntervalSeconds);
  });

  // 8. Window.
  await createWindow();
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    title: 'LocalCortex',
    // Window/taskbar icon. macOS reads the bundle's icon.icns, so this only
    // affects Linux/Windows; the renderer's bundled favicon is the asset that
    // is guaranteed to exist next to the built main.js in the .app/.exe.
    icon: join(__dirname, '../renderer/main_window/favicon.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  // Drop the reference once the window is gone so downstream `?.` chains (theme
  // push, handoffs-changed broadcast) short-circuit instead of touching a stale,
  // destroyed handle.
  mainWindow.on('closed', () => { mainWindow = null; });

  // Once the renderer has loaded, its preload `theme.onApply` listener is
  // registered; push the current effective scheme so the first paint matches
  // the persisted Appearance setting (no flash of the wrong theme).
  mainWindow.webContents.on('did-finish-load', pushThemeToRenderer);

  // Surface renderer load failures (otherwise they manifest as a blank window).
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logger.error(`Renderer failed to load: code=${code} desc=${desc} url=${url}`);
  });
  mainWindow.webContents.on('console-message', (_e, level, message) => {
    // Forward renderer errors/warnings (level >= 2) to the main-process log so
    // they surface for debugging instead of staying buried in DevTools.
    if (level >= 2) logger.warn(`[renderer console] ${message}`);
  });

  // The Forge Vite plugin statically defines `MAIN_WINDOW_VITE_DEV_SERVER_URL`
  // (a global, injected at build time via Vite's `define`) to the dev server URL
  // in dev, and to `undefined` in the packaged build. See the `declare global`
  // at the top of this file.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    // Built renderer output (vite.renderer.config.ts `build.outDir`). This branch
    // runs whenever the app is launched outside `electron-forge start` — most
    // importantly from Playwright E2E, which launches .vite/build/main.js directly.
    await mainWindow.loadFile(join(__dirname, '../renderer/main_window/index.html'));
  }
}

/**
 * Open (or re-focus) the prompt-submit handoff-attach popup for one session.
 *
 * Loads the same renderer entry as the main window but with `?view=handoff-prompt`,
 * which `App.tsx` uses to branch into the popup UI instead of the tabbed shell.
 * The prompt payload is pushed over IPC once the renderer has finished loading.
 * One popup per sessionId: if one is already open, it's focused and refreshed.
 */
function openHandoffPrompt(payload: HandoffPromptPayload): void {
  const existing = promptWindows.get(payload.sessionId);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    existing.webContents.send(IPC.HANDOFF_PROMPT_PUSH, payload);
    return;
  }

  const win = new BrowserWindow({
    width: 480,
    height: 560,
    resizable: false,
    maximizable: false,
    title: payload.mode === 'new' ? 'Attach handoff' : 'Session handoff',
    parent: mainWindow ?? undefined,
    // Not `modal: true` — the main window isn't usable for this anyway, and a
    // modal would block the app if the popup is left open.
    modal: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  promptWindows.set(payload.sessionId, win);
  win.on('closed', () => {
    promptWindows.delete(payload.sessionId);
  });

  win.on('ready-to-show', () => {
    win.show();
    win.focus();
  });

  // Push the prompt payload once the renderer (and its onPrompt listener) is
  // ready — mirrors pushThemeToRenderer.
  win.webContents.on('did-finish-load', () => {
    win.webContents.send(IPC.HANDOFF_PROMPT_PUSH, payload);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logger.error(`Prompt renderer failed to load: code=${code} desc=${desc} url=${url}`);
  });

  const load = MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? win.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}?view=handoff-prompt`)
    : win.loadFile(join(__dirname, '../renderer/main_window/index.html'), {
        query: { view: 'handoff-prompt' },
      });
  load.catch((e) => logError('Failed to load handoff-prompt window', e));
}

// Single instance — focus the existing window on a second launch.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    bootstrap().catch((e) => {
      logError('Failed to start LocalCortex', e);
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(logError);
  });
}

// tech-stack.md §6.5: abort in-flight runs + kill subprocesses on quit.
app.on('before-quit', (event) => {
  if (inFlightAborts.size > 0) {
    event.preventDefault();
    for (const ac of inFlightAborts) ac.abort();
    // Give in-flight runs a moment to unwind, then proceed with quit.
    setTimeout(() => app.exit(0), 2000);
    return;
  }
  scheduler?.clear();
  lifecycle.teardown();
  // Close the ingress server without blocking quit.
  ingressServer?.close().catch(() => {});
});

// macOS: keep running until explicit quit (convention).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
