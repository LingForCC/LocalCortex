import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock `electron` so ipcMain.handle can be captured without a running app.
// The IPC handler registers handlers against channel strings; we intercept
// them in-memory and replay payloads. Electron calls each handler as
// (event, ...args), so we forward a dummy event followed by the payload.
type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, IpcHandler>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: IpcHandler) => {
      handlers.set(channel, fn);
    },
  },
}));

// Import AFTER the mock is registered so `registerHandoffsIpc` sees the stub.
// Dynamic import avoids hoisting-order issues with vi.mock.
async function loadHandler() {
  const { registerHandoffsIpc } = await import('./handoffs.js');
  return registerHandoffsIpc;
}

import { openMemoryDatabase } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { HandoffsRepository } from '../db/repositories/handoffs.js';
import { IPC } from '@shared/schemas/ipc-schema';
import type { DatabaseSync } from 'node:sqlite';
import type { Handoff } from '@shared/types';

let db: DatabaseSync;
let repo: HandoffsRepository;

/** Invoke a captured IPC handler with a dummy event + payload. */
async function invoke(channel: string, payload?: unknown): Promise<unknown> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return fn({}, payload);
}

beforeEach(async () => {
  handlers.clear();
  db = openMemoryDatabase();
  runMigrations(db);
  repo = new HandoffsRepository(db);
});

function makeHandoff(overrides: Partial<Handoff> = {}): Handoff {
  return {
    id: 'h1',
    sessionId: 'sess_a',
    context: { parentTaskId: 'x' },
    reminderTitle: undefined,
    enabled: true,
    createdAt: '2026-07-09T00:00:00Z',
    updatedAt: '2026-07-09T00:00:00Z',
    ...overrides,
  };
}

describe('registerHandoffsIpc', () => {
  it('registers all five handoff channels', async () => {
    const register = await loadHandler();
    register(repo);
    expect(handlers.has(IPC.HANDOFF_LIST)).toBe(true);
    expect(handlers.has(IPC.HANDOFF_GET)).toBe(true);
    expect(handlers.has(IPC.HANDOFF_CREATE)).toBe(true);
    expect(handlers.has(IPC.HANDOFF_DELETE)).toBe(true);
    expect(handlers.has(IPC.HANDOFF_SET_ENABLED)).toBe(true);
  });

  it('HANDOFF_CREATE inserts and returns the canonical row', async () => {
    const register = await loadHandler();
    register(repo);
    const created = (await invoke(IPC.HANDOFF_CREATE, {
      sessionId: 'sess_new',
      context: { parentTaskId: 'o2LO' },
    })) as Handoff | null;
    expect(created).not.toBeNull();
    expect(created!.sessionId).toBe('sess_new');
    expect(created!.context).toEqual({ parentTaskId: 'o2LO' });
    expect(created!.enabled).toBe(true);
  });

  it('HANDOFF_SET_ENABLED flips the flag and returns true', async () => {
    repo.create(makeHandoff({ id: 'h1', enabled: true }));
    const register = await loadHandler();
    register(repo);
    const ok = (await invoke(IPC.HANDOFF_SET_ENABLED, {
      id: 'h1',
      enabled: false,
    })) as boolean;
    expect(ok).toBe(true);
    expect(repo.get('h1')?.enabled).toBe(false);
  });

  it('HANDOFF_DELETE removes a row and returns true', async () => {
    repo.create(makeHandoff({ id: 'h1' }));
    const register = await loadHandler();
    register(repo);
    const ok = (await invoke(IPC.HANDOFF_DELETE, { id: 'h1' })) as boolean;
    expect(ok).toBe(true);
    expect(repo.get('h1')).toBeNull();
  });

  // The key contract for the prompt-submit popup: mutations from the popup
  // window must notify other windows (the main Handoffs panel) so their lists
  // refresh. onChanged fires after create / delete / setEnabled.
  it('onChanged fires after create, delete, and setEnabled', async () => {
    const register = await loadHandler();
    const calls: string[] = [];
    register(repo, () => calls.push('changed'));

    // create
    await invoke(IPC.HANDOFF_CREATE, { sessionId: 's1', context: { k: 'v' } });
    // setEnabled (on the row just created)
    const created = repo.list()[0]!;
    await invoke(IPC.HANDOFF_SET_ENABLED, { id: created.id, enabled: false });
    // delete
    await invoke(IPC.HANDOFF_DELETE, { id: created.id });

    expect(calls).toEqual(['changed', 'changed', 'changed']);
  });

  it('onChanged does NOT fire when delete/setEnabled affect zero rows', async () => {
    const register = await loadHandler();
    const calls: string[] = [];
    register(repo, () => calls.push('changed'));

    // No row exists → delete returns false, onChanged should not fire.
    const del = (await invoke(IPC.HANDOFF_DELETE, { id: 'nope' })) as boolean;
    expect(del).toBe(false);
    // No row exists → setEnabled returns false, onChanged should not fire.
    const en = (await invoke(IPC.HANDOFF_SET_ENABLED, {
      id: 'nope',
      enabled: true,
    })) as boolean;
    expect(en).toBe(false);

    expect(calls).toHaveLength(0);
  });

  it('omitting onChanged is fine (no broadcast, no throw)', async () => {
    const register = await loadHandler();
    register(repo); // no second arg
    // Should not throw:
    const created = (await invoke(IPC.HANDOFF_CREATE, {
      sessionId: 's1',
      context: { k: 'v' },
    })) as Handoff | null;
    expect(created).not.toBeNull();
  });
});
