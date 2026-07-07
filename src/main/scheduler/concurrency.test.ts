import { describe, it, expect } from 'vitest';
import { ConcurrencyQueue } from './concurrency.js';

describe('ConcurrencyQueue', () => {
  it('runs tasks up to the concurrency limit and queues the rest (FIFO)', async () => {
    const q = new ConcurrencyQueue({ concurrency: 2 });
    const order: string[] = [];
    const started: number[] = [];

    const makeTask = (id: string, ms: number) => async () => {
      started.push(Number(id));
      order.push(`start-${id}`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`end-${id}`);
      return id;
    };

    // Enqueue 4 tasks; only 2 run at first.
    const results = await Promise.all([
      q.add(makeTask('1', 20)),
      q.add(makeTask('2', 20)),
      q.add(makeTask('3', 10)),
      q.add(makeTask('4', 10)),
    ]);

    expect(results).toEqual(['1', '2', '3', '4']);
    // FIFO: 1 and 2 start before 3 and 4.
    expect(order.slice(0, 2)).toEqual(['start-1', 'start-2']);
    // Tasks 3 and 4 only start after the first slot frees.
    expect(order.indexOf('start-3')).toBeGreaterThan(order.indexOf('end-1'));
    expect(q.idle).toBe(true);
  });

  it('never exceeds the concurrency cap', async () => {
    const cap = 3;
    const q = new ConcurrencyQueue({ concurrency: cap });
    let peak = 0;
    let current = 0;

    const makeTask = () => async () => {
      current++;
      peak = Math.max(peak, current);
      await new Promise((r) => setTimeout(r, 15));
      current--;
    };

    await Promise.all(Array.from({ length: 10 }, () => q.add(makeTask())));
    expect(peak).toBeLessThanOrEqual(cap);
    expect(q.runningCount).toBe(0);
  });

  it('rejects when a task fn rejects, without stalling the queue', async () => {
    const q = new ConcurrencyQueue({ concurrency: 1 });
    const ok = q.add(async () => 'ok');
    const bad = q.add(async () => {
      throw new Error('boom');
    });
    const after = q.add(async () => 'after');

    await expect(ok).resolves.toBe('ok');
    await expect(bad).rejects.toThrow('boom');
    await expect(after).resolves.toBe('after');
    expect(q.idle).toBe(true);
  });

  it('fires onStart with running/queued counts', async () => {
    const events: { running: number; queued: number }[] = [];
    const q = new ConcurrencyQueue({ concurrency: 2, onStart: (i) => events.push({ ...i }) });
    await Promise.all([
      q.add(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return 1;
      }),
      q.add(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return 2;
      }),
      q.add(async () => 3), // this one queues while the first two run
    ]);
    // First two tasks start immediately (concurrency 2); the third queues.
    expect(events[0]).toEqual({ running: 1, queued: 0 });
    expect(events[1]).toEqual({ running: 2, queued: 0 });
    expect(events[2]).toEqual({ running: 2, queued: 0 });
  });

  it('throws for non-positive concurrency', () => {
    expect(() => new ConcurrencyQueue({ concurrency: 0 })).toThrow();
    expect(() => new ConcurrencyQueue({ concurrency: -1 })).toThrow();
  });

  it('drained() resolves immediately when already idle', async () => {
    const q = new ConcurrencyQueue({ concurrency: 2 });
    await expect(q.drained()).resolves.toBeUndefined();
  });
});
