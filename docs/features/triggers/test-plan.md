# Triggers — Test Plan

Covers **cadence math**, **event matching**, **template rendering**, and the **ingress HTTP listener**. Rule CRUD is covered in [Rules](../rules/test-plan.md); agent execution in [Agent backends](../agent-backends/test-plan.md).

---

## In scope
- Tick cadence: effective-interval resolution + the 300s floor.
- Scheduler: per-rule timers (start/stop/reschedule), callback-error isolation.
- Event matcher: eventType match + glob filters.
- Prompt builder template rendering (`{{var}}`).
- Fastify ingress: validation (400), secret (401), match → enqueue, logging.

## Out of scope
- Run-loop orchestration (stage → run → record → stop) → [Stop conditions](../stop-conditions/test-plan.md) + [Observability](../observability/test-plan.md).
- Concurrency cap behavior → [Settings](../settings/test-plan.md).

---

## Test types
| Type | Tool | Where |
| --- | --- | --- |
| Unit (pure logic) | Vitest | `src/**/*.test.ts` |
| Integration (HTTP) | Vitest + Fastify `inject` | planned |
| E2E | Playwright / shell `curl` | `playwright/triggers.spec.ts` (partial) |
| Manual | operator | — |

---

## Unit tests

### Cadence math — `effectiveIntervalSeconds` (`src/main/scheduler/scheduler.ts`)
**Status:** ✅ covered — `src/main/scheduler/scheduler.test.ts` (5 cases).

| # | Case | Expected |
| --- | --- | --- |
| T-C1 | rule override wins | returns override |
| T-C2 | omitted → global default | returns global |
| T-C3 | omitted + no global → built-in default (3600) | returns 3600 |
| T-C4 | value below 300 → clamped to 300 | returns 300 |
| T-C5 | global below 300 → clamped | returns 300 |
| T-C6 | non-tick rule → throws | throws (clear message) |

### Scheduler — `Scheduler` (`src/main/scheduler/scheduler.ts`)
**Status:** ✅ covered — `src/main/scheduler/scheduler.test.ts` (6 cases, fake-timer-injected).

| # | Case | Expected |
| --- | --- | --- |
| T-S1 | schedules enabled tick rule, fires onTick | ✅ existing |
| T-S2 | skips disabled rules | ✅ existing |
| T-S3 | skips event-triggered rules | ✅ existing |
| T-S4 | unschedule clears the timer | ✅ existing |
| T-S5 | rescheduleAll replaces the set | ✅ existing |
| T-S6 | onTick error is swallowed; next tick still fires | ✅ existing |

> **Add:** a case verifying re-arm happens _before_ the callback, so a slow run can't delay the next tick (currently implicit).

### Event matcher — `matchEventsToRules` / `globMatch` (`src/main/events/matcher.ts`)
**Status:** ✅ covered — `src/main/events/matcher.test.ts` (11 cases).

| # | Case | Expected |
| --- | --- | --- |
| T-M1 | matches by eventType | ✅ existing |
| T-M2 | rejects on eventType mismatch | ✅ existing |
| T-M3 | never returns tick rules | ✅ existing |
| T-M4 | glob filter on a payload field | ✅ existing |
| T-M5 | all filter entries must match (AND) | ✅ existing |
| T-M6 | missing filtered field → no match | ✅ existing |
| T-M7 | object/array value vs string glob → no match | ✅ existing |
| T-M8 | multiple rules match one event | ✅ existing |
| T-M9–M11 | glob `*`, `?`, exact | ✅ existing (`globMatch`) |

### Template rendering — `renderTemplate` / `buildPrompt` (`src/main/agent/prompt-builder.ts`)
**Status:** ✅ covered — `src/main/agent/prompt-builder.test.ts` (11 cases).

| # | Case | Expected |
| --- | --- | --- |
| T-P1 | simple top-level vars | ✅ existing |
| T-P2 | dotted nested path | ✅ existing |
| T-P3 | unknown var → empty | ✅ existing |
| T-P4 | null/undefined → empty | ✅ existing |
| T-P5 | object value → empty (no `[object Object]`) | ✅ existing |
| T-P6 | number/boolean stringified | ✅ existing |
| T-P7 | whitespace inside braces tolerated | ✅ existing |
| T-P8 | tick rule (no payload) — templates left untouched, status contract present | ✅ existing |

---

## Integration — ingress HTTP listener (`src/main/events/ingress.ts`)
**Status:** not yet implemented as a test suite (the module is wired in `src/main/index.ts` but not unit/integration-tested). Use Fastify's `inject` to avoid binding a port.

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| T-I1 | valid event matches a rule → 200, onMatched called | POST `/event` with `type`+`timestamp` | `{ ok:true, matched:1 }` |
| T-I2 | event with no `type` → 400 | POST without `type` | 400 `{ error:'invalid event' }` |
| T-I3 | event with no `timestamp` → 400 | POST without `timestamp` | 400 |
| T-I4 | no matching rules → 200, matched:0 | POST an event no rule wants | `{ ok:true, matched:0 }` |
| T-I5 | shared secret set + correct header → 200 | configure secret, send header | 200 |
| T-I6 | shared secret set + wrong/missing header → 401 | configure secret, omit header | 401 |
| T-I7 | `/health` returns ok | GET `/health` | 200 `{ ok:true }` |
| T-I8 | every received event is logged | POST event; spy on logger | logger.info called with type/timestamp |

---

## E2E / Manual

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| T-E1 | Real Codex hook fires an event rule | Install `codex-hook.sh`; complete a Codex session in a watched workdir | A run appears in Run history with the event payload — **manual** (needs a live Codex session) |
| T-E2 | `curl` to ingress fires a rule | `curl -X POST localhost:4729/event ...` | Run appears ✅ existing (`playwright/triggers.spec.ts`) |
| T-E3 | Filter excludes an event | POST an event whose `workdir` doesn't match the filter | `matched:0`, no run ✅ existing (`playwright/triggers.spec.ts`) |
| T-E4 | Tick rule fires on schedule | Create a tick rule with `intervalSeconds:300`; wait | Run appears after ~5 min — **manual** (gated by the 300s floor) |
| T-E5 | Editing a tick rule's interval reschedules it | Change interval; observe tick timing | Next tick respects new interval — **manual** |

---

## Related
- [Triggers README](./README.md)
- [design: §6.7 ingress](../../architecture.md#67-event-ingress--local-http-listener)
