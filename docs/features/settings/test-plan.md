# Settings — Test Plan

Covers the **`SettingsRepository`** (defaults, merge-on-update, secret persistence), the **concurrency queue** (the cap mechanism), and the **`settings:*` IPC handlers**. The scheduler's use of `tickIntervalSeconds` is covered in [Triggers](../triggers/test-plan.md); the ingress secret's enforcement is covered in [Triggers (ingress)](../triggers/test-plan.md).

---

## In scope
- `SettingsRepository.get` (defaults on empty table, incl. appearance + Codex model/effort defaults) + `.update` (partial merge).
- `ConcurrencyQueue` (cap enforcement, FIFO, error isolation, drain).
- `settings:get/update` IPC (incl. `ingressSecret: null` → clear; CLI path validation; appearance → `nativeTheme`; codexModel/codexReasoningEffort round-trip).
- `cli-resolver.ts` (explicit → PATH → undefined fallback, `isExecutablePath`).

## Out of scope
- Scheduler cadence using the value → [Triggers](../triggers/test-plan.md).
- Ingress 401 on bad secret → [Triggers](../triggers/test-plan.md).

---

## Test types
| Type | Tool | Where |
| --- | --- | --- |
| Unit | Vitest | `src/**/*.test.ts` |
| E2E | Playwright (Settings view) | `playwright/settings.spec.ts` |
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
| SE-R5 | codex/claude CLI paths persist | ✅ existing |
| SE-R6 | clearing CLI paths (`''`) doesn't resurrect old values | ✅ existing |
| SE-R7 | appearance defaults to `system`; explicit `dark`/`light` round-trips | ✅ existing |
| SE-R8 | **codexModel defaults to `gpt-5.5`; codexReasoningEffort defaults to `medium`** | ✅ new |
| SE-R9 | **codexModel + codexReasoningEffort round-trip through `update()` → `get()`** | ✅ new |
| SE-R10 | **clearing codexModel to `''` reverts to the default (`gpt-5.5`)** — empty string is treated as unset so the schema default re-applies | ✅ new |

### cli-resolver — `src/main/agent/cli-resolver.test.ts`
**Status:** ✅ covered — 10 cases.

| # | Case | Expected |
| --- | --- | --- |
| SE-C1 | explicit path returned as-is (non-empty) | ✅ existing |
| SE-C2 | explicit path is trimmed | ✅ existing |
| SE-C3 | empty/undefined explicit → PATH lookup (string\|undefined, no throw) | ✅ existing |
| SE-C4 | `resolveOnPath` finds `node` on PATH | ✅ existing |
| SE-C5 | `resolveOnPath` returns undefined for missing binary / unset PATH | ✅ existing |
| SE-C6 | `isExecutablePath('')` → true (auto-detect) | ✅ existing |
| SE-C7 | `isExecutablePath` rejects non-existent path | ✅ existing |
| SE-C8 | `isExecutablePath` accepts an executable `node` | ✅ existing |

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
**Status:** not unit-tested (Electron-coupled). Notes: `ingressSecret: null` is normalized to `''` (clear) by the handler; the handler validates CLI paths on save (`existsSync` + `accessSync(X_OK)`) and returns `{ ok: false, error }` instead of throwing on a bad path; after a successful update it invokes an `onUpdate` hook so the bootstrap re-applies `nativeTheme.themeSource` from `appearance` and re-pushes the effective scheme to the renderer over `theme:apply` (covered in E2E SE-E4).

| # | Case | Expected |
| --- | --- | --- |
| SE-I1 | `settings:get` returns current + defaults | full AppSettings |
| SE-I2 | `settings:update` with tick+concurrency persists both | merged returned |
| SE-I3 | `settings:update { ingressSecret: 'x' }` stores it | secret set |
| SE-I4 | `settings:update { ingressSecret: null }` clears it | secret unset |
| SE-I5 | invalid tick (<300) rejected by schema | throws |
| SE-I6 | `settings:update { codexCliPath: '/bad' }` (non-existent) | `{ ok: false, error }` |
| SE-I7 | `settings:update { claudeCliPath: '/bad' }` (non-existent) | `{ ok: false, error }` |
| SE-I8 | `settings:update { codexCliPath: '' }` clears it | `{ ok: true }`, path unset |
| SE-I9 | `settings:update { codexCliPath: null }` clears it | `{ ok: true }`, path unset |
| SE-I10 | `settings:update { appearance: 'dark' }` persists + re-applies `nativeTheme` + emits `theme:apply` | `{ ok: true }`, themeSource=dark, renderer `.dark` |

---

## E2E (Playwright)

**Status:** ✅ covered — `playwright/settings.spec.ts` (4 cases), on the shared isolation fixture.

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| SE-E1 | Settings persist across reload | change tick interval + concurrency → Save → relaunch | both values restored ✅ existing (automates the former SE-M4) |
| SE-E2 | Invalid tick (< 300) rejected | set tick to 100 → Save → relaunch | schema rejects; default still in place ✅ existing (E2E equivalent of SE-I5) |
| SE-E3 | Appearance persists across reload | change Appearance to `dark` → Save → relaunch | `dark` restored ✅ existing |
| SE-E4 | Appearance applies immediately | change Appearance to `dark` → Save | `nativeTheme.themeSource === 'dark'` + renderer `.dark` class / dark `body` bg; flip to `light` reverses it ✅ existing |

---

## Manual

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| SE-M1 | Tick default reschedules rules | change interval; observe a dependent tick rule's timing | next tick honors new interval |
| SE-M2 | Concurrency cap bounds parallel runs | cap=1; trigger 3 runs quickly | runs execute serially (no overlap) |
| SE-M3 | Secret gates the ingress | set a secret; POST without header | 401; with header → 200 |
| SE-M4 | Settings persist across restart | set values, quit, relaunch | values restored |
| SE-M5 | CLI path applies without restart | set `codexCliPath` to a local binary; trigger a run | next run spawns the local binary (verify via logs) |
| SE-M6 | Bad CLI path rejected on save | enter a non-existent path → Save | inline error; value not persisted |
| SE-M7 | `System` follows the OS | set Appearance to `System`; toggle OS dark mode | window follows the OS scheme without a restart |
| SE-M8 | **Codex model + effort defaults persist** | set codexModel `gpt-5.5`, effort `medium` → Save → relaunch | both values restored ✅ new |
| SE-M9 | **Codex model default applies without restart** | change codexModel in Settings → Save; trigger a Codex run with no per-rule model | next run uses the new default (see [Agent backends A-M9](../agent-backends/test-plan.md#a-m9)) ✅ new |

---

## Related
- [Settings README](./README.md)
- [Triggers test-plan](../triggers/test-plan.md) (scheduler + ingress)
- [design: §6.4](../../architecture.md#64-concurrency--capped-parallelism), [§6.5](../../architecture.md#65-cadence--global-default--per-rule-override)
