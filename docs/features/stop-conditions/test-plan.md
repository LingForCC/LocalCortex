# Stop Conditions — Test Plan

Covers **stop evaluation** (`evaluateStop`: status → expiresAt → maxRuns priority), **maxRuns resolution**, and the **run-loop → disable** wiring. The status-block _parser_ is covered in [Observability](../observability/test-plan.md) (it produces the `parsedStatus` this feature consumes).

---

## In scope
- `evaluateStop` decision logic + priority ordering, including the **event-rule carve-out** (event rules are never disabled by run outcome; only an explicit `maxRuns`/`expiresAt` or a manual toggle stops them).
- `resolveMaxRuns` (rule override / null-unlimited / global default / built-in default).
- Run-loop applying the decision (`setEnabled(false, reason)`).
- Re-enable resets run count + clears reason.

## Out of scope
- Parsing the status block → [Observability](../observability/test-plan.md).
- The scheduler honouring `enabled=false` → [Triggers](../triggers/test-plan.md).

---

## Test types
| Type | Tool | Where |
| --- | --- | --- |
| Unit | Vitest | `src/**/*.test.ts` |
| Manual | operator | — |

---

## Unit tests

### `resolveMaxRuns` — `src/main/agent/stop-check.test.ts`
**Status:** ✅ covered (4 cases).

| # | Case | Expected |
| --- | --- | --- |
| S-X1 | explicit number | returns it |
| S-X2 | explicit `null` | returns null (unlimited) |
| S-X3 | undefined + global given | returns global |
| S-X4 | undefined + no global | returns built-in default (48) |

### `evaluateStop` — `src/main/agent/stop-check.test.ts`
**Status:** ✅ covered (10 tick cases + 7 event cases).

| # | Case | Expected |
| --- | --- | --- |
| S-E1 | parsed `done` → disable (tick) | ✅ existing |
| S-E2 | parsed `error` → disable (tick) | ✅ existing |
| S-E3 | parsed `active` → keep running (tick) | ✅ existing |
| S-E4 | no parsed status → keep running (tick) | ✅ existing |
| S-E5 | `expiresAt` in past → disable (tick) | ✅ existing |
| S-E6 | `expiresAt` in future → keep (tick) | ✅ existing |
| S-E7 | runCount ≥ rule maxRuns → disable (tick) | ✅ existing |
| S-E8 | runCount reaches global default → disable (tick) | ✅ existing |
| S-E9 | `maxRuns:null` honored as unlimited (tick) | ✅ existing |
| S-E10 | agent `done` takes priority over maxRuns (tick) | ✅ existing (priority) |
| S-E11 | event rule + `done` → keep running | ✅ event carve-out |
| S-E12 | event rule + `error` → keep running | ✅ event carve-out |
| S-E13 | event rule + default maxRuns cap → keep running | ✅ default cap suppressed |
| S-E14 | event rule + explicit `maxRuns:1` reached → disable | ✅ one-shot preserved |
| S-E15 | event rule + past `expiresAt` → disable | ✅ time-box preserved |
| S-E16 | event rule + `maxRuns:null` + `done` → keep running | ✅ |
| S-E17 | event rule + explicit `maxRuns:10` reached → disable | ✅ explicit cap applies |

> **Add:** a case asserting `error` priority over `expiresAt`, and `expiresAt` priority over `maxRuns`, to lock the full ordering (tick rules).

### Run-loop → disable — `src/main/agent/run-loop.test.ts`
**Status:** ✅ covered.

| # | Case | Expected |
| --- | --- | --- |
| S-L1 | tick rule + agent `done` → rule disabled + reason recorded | ✅ existing |
| S-L2 | agent `active` → rule stays enabled | ✅ existing |
| S-L3 | event rule + agent `done` → rule stays enabled, no reason | ✅ event carve-out |

> **Add:** a case driving `maxRuns` to its limit via repeated stubbed runs and asserting the disable reason is "max runs reached (N)".

### Re-enable behavior — `RulesRepository`
**Status:** ✅ covered in `db.test.ts` (R-R4: set-enabled records reason; re-enable clears it; resetRunCount zeroes).

---

## Manual

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| S-M1 | One-off rule stops itself | Create a rule the agent can complete; run until `done` | rule auto-disables; reason shown |
| S-M2 | maxRuns backstop fires | `maxRuns:2`; run 3 times | disables after 2nd with "max runs reached (2)" |
| S-M3 | expiresAt backstop fires | `expiresAt` 1 min in future; wait | disables at/after expiry |
| S-M4 | Re-enable resets counter | disable a rule, re-enable, run | counter back to 0; reason cleared |
| S-M5 | No block + no backstop → runs forever | `maxRuns:null`, no expiresAt, agent never emits status | rule keeps running (document the risk) |
| S-M6 | Event rule survives `done` | event-triggered rule; agent emits `done` on a run; post another event | rule stays enabled and runs again on the next event |

---

## Related
- [Stop conditions README](./README.md)
- [Observability test-plan](../observability/test-plan.md) (status parser)
- [design: §6.6](../../architecture.md#66-stop-conditions--agent-signaled-completion--structural-backstop)
