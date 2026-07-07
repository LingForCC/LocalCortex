# Settings — Test Plan

Covers the **`SettingsRepository`** (defaults, merge-on-update, secret persistence), the **concurrency queue** (the cap mechanism), and the **`settings:*` IPC handlers**. The scheduler's use of `tickIntervalSeconds` is covered in [Triggers](../triggers/test-plan.md); the ingress secret's enforcement is covered in [Triggers (ingress)](../triggers/test-plan.md).

---

## In scope
- `SettingsRepository.get` (defaults on empty table) + `.update` (partial merge).
- `ConcurrencyQueue` (cap enforcement, FIFO, error isolation, drain).
- `settings:get/update` IPC (incl. `ingressSecret: null` → clear).

## Out of scope
- Scheduler cadence using the value → [Triggers](../triggers/test-plan.md).
- Ingress 401 on bad secret → [Triggers](../triggers/test-plan.md).

---

## Test types
| Type | Tool | Where |
| --- | --- | --- |
| Unit | Vitest | `src/**/*.test.ts` |
| Manual | operator | — |

---

## Unit tests

### SettingsRepository — `src/main/db/db.test.ts` → `SettingsRepository` suite
**Status:** ✅ covered.

| # | Case | Expected |
| --- | --- | --- |
| SE-R1 | defaults on empty table (tick=3600, concurrency=3) | ✅ existing |
| SE-R2 | partial update merges (set concurrency, tick unchanged) | ✅ existing |
| SE-R3 | second update preserves the first | ✅ existing |
| SE-R4 | ingress secret persists | ✅ existing |

### ConcurrencyQueue — `src/main/scheduler/concurrency.test.ts`
**Status:** ✅ covered — 6 cases.

| # | Case | Expected |
| --- | --- | --- |
| SE-Q1 | runs up to cap, queues the rest FIFO | ✅ existing |
| SE-Q2 | never exceeds the cap (peak ≤ cap) | ✅ existing |
| SE-Q3 | a rejecting task doesn't stall the queue | ✅ existing |
| SE-Q4 | onStart fires with running/queued counts | ✅ existing |
| SE-Q5 | throws for non-positive concurrency | ✅ existing |
| SE-Q6 | drained() resolves immediately when idle | ✅ existing |

---

## IPC — `src/main/ipc/settings.ts`
**Status:** not unit-tested (Electron-coupled). Note: `ingressSecret: null` is normalized to `''` (clear) by the handler.

| # | Case | Expected |
| --- | --- | --- |
| SE-I1 | `settings:get` returns current + defaults | full AppSettings |
| SE-I2 | `settings:update` with tick+concurrency persists both | merged returned |
| SE-I3 | `settings:update { ingressSecret: 'x' }` stores it | secret set |
| SE-I4 | `settings:update { ingressSecret: null }` clears it | secret unset |
| SE-I5 | invalid tick (<300) rejected by schema | throws |

---

## Manual

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| SE-M1 | Tick default reschedules rules | change interval; observe a dependent tick rule's timing | next tick honors new interval |
| SE-M2 | Concurrency cap bounds parallel runs | cap=1; trigger 3 runs quickly | runs execute serially (no overlap) |
| SE-M3 | Secret gates the ingress | set a secret; POST without header | 401; with header → 200 |
| SE-M4 | Settings persist across restart | set values, quit, relaunch | values restored |

---

## Related
- [Settings README](./README.md)
- [Triggers test-plan](../triggers/test-plan.md) (scheduler + ingress)
- [design: §6.4](../../architecture.md#64-concurrency--capped-parallelism), [§6.5](../../architecture.md#65-cadence--global-default--per-rule-override)
