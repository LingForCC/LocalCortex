# Stop Conditions — Test Plan

Covers **stop evaluation** (`evaluateStop`: status → expiresAt → maxRuns priority), **maxRuns resolution**, and the **run-loop → disable** wiring. The status-block _parser_ is covered in [Observability](../observability/test-plan.md) (it produces the `parsedStatus` this feature consumes).

---

## In scope
- `evaluateStop` decision logic + priority ordering.
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
**Status:** ✅ covered (10 cases).

| # | Case | Expected |
| --- | --- | --- |
| S-E1 | parsed `done` → disable | ✅ existing |
| S-E2 | parsed `error` → disable | ✅ existing |
| S-E3 | parsed `active` → keep running | ✅ existing |
| S-E4 | no parsed status → keep running | ✅ existing |
| S-E5 | `expiresAt` in past → disable | ✅ existing |
| S-E6 | `expiresAt` in future → keep | ✅ existing |
| S-E7 | runCount ≥ rule maxRuns → disable | ✅ existing |
| S-E8 | runCount reaches global default → disable | ✅ existing |
| S-E9 | `maxRuns:null` honored as unlimited | ✅ existing |
| S-E10 | agent `done` takes priority over maxRuns | ✅ existing (priority) |

> **Add:** a case asserting `error` priority over `expiresAt`, and `expiresAt` priority over `maxRuns`, to lock the full ordering.

### Run-loop → disable — `src/main/agent/run-loop.test.ts`
**Status:** ✅ covered.

| # | Case | Expected |
| --- | --- | --- |
| S-L1 | agent `done` → rule disabled + reason recorded | ✅ existing |
| S-L2 | agent `active` → rule stays enabled | ✅ existing |

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

---

## Related
- [Stop conditions README](./README.md)
- [Observability test-plan](../observability/test-plan.md) (status parser)
- [design: §6.6](../../architecture.md#66-stop-conditions--agent-signaled-completion--structural-backstop)
