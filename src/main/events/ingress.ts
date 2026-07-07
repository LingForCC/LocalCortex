/**
 * Local HTTP event ingress for event-triggered rules.
 *
 * Spec: docs/architecture.md §6.7, §8; docs/rule-config-schema.md §3.2.
 *
 * A loopback-only Fastify listener on 127.0.0.1:PORT/event receives POSTed JSON
 * events from external sources (Codex hooks, Claude Code hooks, shell scripts,
 * build tools). For each event:
 *   1. validate it has a `type` and `timestamp` (400 otherwise);
 *   2. optionally require a shared-secret header (architecture.md §8);
 *   3. match it to rules whose `trigger.eventType` equals the event's `type`,
 *      applying optional glob filters;
 *   4. enqueue each matched rule's run (via the provided callback, which feeds
 *      the shared capped-parallelism queue);
 *   5. log every received event (architecture.md §8 mitigation).
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { IncomingEventSchema } from '@shared/schemas/event-schema';
import type { IncomingEvent, Rule } from '@shared/types';
import { matchEventsToRules } from './matcher.js';
import { logger } from '../observability/logger.js';
import { INGRESS_HOST, INGRESS_PORT } from '@shared/constants';

/** What the ingress does when an event matches one or more rules. */
export type EnqueueFn = (event: IncomingEvent, matchedRules: Rule[]) => Promise<void> | void;

export interface IngressOptions {
  port?: number;
  host?: string;
  /** If set, every request must include this header value (shared secret). */
  sharedSecret?: string;
  /** Header name carrying the shared secret (default: x-localcortex-secret). */
  secretHeader?: string;
  /** All rules (event-triggered ones are filtered inside the matcher). */
  getRules: () => Rule[];
  /** Called with matched rules; enqueues runs onto the shared queue. */
  onMatched: EnqueueFn;
}

/**
 * Build (but don't start) the Fastify ingress server. Exposed so tests can
 * inject a config and call listen() themselves.
 */
export function buildIngress(opts: IngressOptions): FastifyInstance {
  const port = opts.port ?? INGRESS_PORT;
  const host = opts.host ?? INGRESS_HOST;
  const secretHeader = opts.secretHeader ?? 'x-localcortex-secret';

  const app = Fastify({ logger: false });

  // Health check.
  app.get('/health', async () => ({ ok: true, port }));

  app.post<{ Body: unknown }>('/event', async (request, reply) => {
    // Shared-secret check (architecture.md §8 mitigation).
    if (opts.sharedSecret) {
      const provided = (request.headers[secretHeader] as string | undefined) ?? '';
      if (provided !== opts.sharedSecret) {
        logger.warn(`ingress: rejected event (bad ${secretHeader})`);
        return reply.code(401).send({ error: 'unauthorized' });
      }
    }

    const parsed = IncomingEventSchema.safeParse(request.body);
    if (!parsed.success) {
      logger.warn(`ingress: rejected malformed event: ${parsed.error.message}`);
      return reply.code(400).send({ error: 'invalid event', details: parsed.error.issues });
    }
    const event: IncomingEvent = parsed.data;

    // Log every received event (architecture.md §8).
    logger.info(
      `ingress: event type=${event.type} ts=${event.timestamp} payloadKeys=${Object.keys(event.payload).join(',')}`,
    );

    const matched = matchEventsToRules(event, opts.getRules());
    if (matched.length > 0) {
      await opts.onMatched(event, matched);
    }
    return reply.code(200).send({ ok: true, matched: matched.length });
  });

  // Decorate with start/stop helpers carrying the bound host/port.
  return Object.assign(app, { _lcPort: port, _lcHost: host });
}

/**
 * Start the ingress server. Resolves once listening, returning the server.
 */
export async function startIngress(opts: IngressOptions): Promise<FastifyInstance> {
  const app = buildIngress(opts);
  const port = (app as unknown as { _lcPort: number })._lcPort;
  const host = (app as unknown as { _lcHost: string })._lcHost;
  await app.listen({ port, host });
  logger.info(`ingress: listening on http://${host}:${port}/event`);
  return app;
}
