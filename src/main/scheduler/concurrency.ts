/**
 * Capped-parallelism async queue.
 *
 * Spec: docs/architecture.md §6.4. A queue caps concurrent agent runs
 * (configurable, default 3). Excess runs queue. Used by BOTH the scheduler
 * (tick-triggered rules) and the event ingress (event-triggered rules) so the
 * two paths share one global concurrency budget.
 *
 * Pure logic — no `electron` import. Testable by counting concurrent execution.
 */

export interface ConcurrencyQueueOptions {
  concurrency: number;
  /** Optional hook fired when a task starts (for observability). */
  onStart?: (info: { running: number; queued: number }) => void;
}

/**
 * A type-erased queued task. `fn` returns an unknown-typed promise (the real
 * type is captured by the per-call Promise<T>); `resolve`/`reject` forward the
 * result to that promise. Keeping the queue uniform (`QueuedTask`, no generic)
 * avoids `unknown`-to-`T` variance errors at the `shift()` site.
 */
interface QueuedTask {
  fn: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

/**
 * Promise-based queue that runs at most `concurrency` tasks at a time.
 * FIFO order. Resolves each task with its fn's result (or rejects with its error).
 */
export class ConcurrencyQueue {
  private readonly concurrency: number;
  private readonly onStart?: (info: { running: number; queued: number }) => void;
  private running = 0;
  private readonly queue: QueuedTask[] = [];

  constructor(opts: ConcurrencyQueueOptions) {
    if (!Number.isInteger(opts.concurrency) || opts.concurrency < 1) {
      throw new Error(`concurrency must be a positive integer, got ${opts.concurrency}`);
    }
    this.concurrency = opts.concurrency;
    this.onStart = opts.onStart;
  }

  /** Current number of in-flight tasks. */
  get runningCount(): number {
    return this.running;
  }

  /** Current number of queued (not yet started) tasks. */
  get queuedCount(): number {
    return this.queue.length;
  }

  /** True when nothing is running and nothing is queued. */
  get idle(): boolean {
    return this.running === 0 && this.queue.length === 0;
  }

  /**
   * Add a task. Resolves/rejects with the task fn's outcome. FIFO execution.
   */
  add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // Type-erase the task for storage; re-establish the T type via the casts.
      const task: QueuedTask = {
        fn,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      this.queue.push(task);
      this.pump();
    });
  }

  /** Attempt to launch queued tasks up to the concurrency limit. */
  private pump(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift() as QueuedTask;
      this.running++;
      this.onStart?.({ running: this.running, queued: this.queue.length });

      task
        .fn()
        .then(
          (value) => task.resolve(value),
          (error) => task.reject(error),
        )
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }

  /**
   * Resolve once the queue is fully drained (idle). Useful for tests/shutdown.
   * If the queue is already idle, resolves immediately.
   */
  async drained(): Promise<void> {
    if (this.idle) return;
    await new Promise<void>((resolve) => {
      const check = () => {
        if (this.idle) resolve();
        else setTimeout(check, 10);
      };
      check();
    });
  }
}
