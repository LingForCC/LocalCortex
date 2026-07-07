/**
 * Zod schema for an event POSTed to the local ingress (architecture.md §6.7).
 *
 * Requires `type` and `timestamp` (the ingress rejects payloads missing either
 * with HTTP 400). All other fields are open-ended — whatever the external source
 * sends becomes available as template variables in rule text.
 */

import { z } from 'zod';

export const IncomingEventSchema = z.object({
  /** The event type, matched against rules' `trigger.eventType`. */
  type: z.string().trim().min(1),
  /** Required ISO-ish timestamp string; validated loosely then normalized. */
  timestamp: z.string().trim().min(1),
  /** Free-form payload — source/summary/workdir/sessionId/etc. live here. */
  payload: z.record(z.string(), z.unknown()).default({}),
});

/** A normalized event as the matcher sees it (payload flattened up for convenience). */
export const NormalizedEventSchema = z.object({
  type: z.string().min(1),
  timestamp: z.string().min(1),
  source: z.string().optional(),
});
