# Observability — Test Plan

Covers **run recording** (the `runs` table + repository), the **run-loop → record** path, and the **status-block parser** that produces `parsedStatus`. UI inspection is covered by manual/E2E.

---

## In scope
- `RunsRepository` (create / get / list, cascade-delete, JSON fields).
- Run-loop recording (prompt, tool calls, tokens, duration, parsed status).
- `parseStatusBlock` (lenient transcript scan).
- `runs:list/get/trigger` IPC.

## Out of scope
- Status-driven _disabling_ logic → [Stop conditions](../stop-conditions/test-plan.md).
- Agent execution → [Agent backends](../agent-backends/test-plan.md).

---

## Test types
| Type | Tool | Where |
| --- | --- | --- |
| Unit | Vitest | `src/**/*.test.ts` |
| E2E | Playwright (Run history view) | `playwright/observability.spec.ts` (partial) |
| Manual | operator | — |

---

## Unit tests

### RunsRepository — `src/main/db/db.test.ts` → `RunsRepository` suite
**Status:** ✅ covered.

| # | Case | Expected |
| --- | --- | --- |
| O-R1 | create + get round-trips all fields (prompt, toolCalls, tokens, parsedStatus) | ✅ existing |
| O-R2 | list newest-first; optional rule filter | ✅ existing |
| O-R3 | cascade-delete: deleting a rule removes its runs | ✅ existing |

> **Add:** a case asserting a run with no toolCalls defaults to `[]` and `parsedStatus` absent when no block was found.

### Status-block parser — `src/main/agent/status-parser.test.ts`
**Status:** ✅ covered — 14 cases. This is the lenient parser that extracts `{status, reason}` from the agent transcript (the §8 mitigation for missed/malformed blocks).

| # | Case | Expected |
| --- | --- | --- |
| O-P1 | clean block on its own line | ✅ existing |
| O-P2 | `active` / `error` statuses | ✅ existing |
| O-P3 | block embedded mid-message (lenient scan) | ✅ existing |
| O-P4 | first valid block wins | ✅ existing |
| O-P5 | non-status JSON objects ignored | ✅ existing |
| O-P6 | malformed JSON skipped, keeps scanning | ✅ existing |
| O-P7 | nested JSON doesn't miscount braces | ✅ existing |
| O-P8 | braces inside string literals handled | ✅ existing |
| O-P9 | null on no block | ✅ existing |
| O-P10 | null on invalid status value | ✅ existing |
| O-P11–P14 | empty input, empty reason, extra fields, whitespace | ✅ existing |

### Run-loop → record — `src/main/agent/run-loop.test.ts`
**Status:** ✅ covered (7 cases, stub runner + in-memory DB).

| # | Case | Expected |
| --- | --- | --- |
| O-L1 | successful run records prompt + parsed status | ✅ existing |
| O-L2 | event payload stored on the run | ✅ existing (event render case) |
| O-L3 | `error`/`done` parsed status reflected on the run | ✅ existing |
| O-L4 | runner failure (post-staging) recorded as an `error` run instead of thrown; `durationMs` recorded and non-negative | ✅ existing |

> The `durationMs`-is-recorded case is now covered by O-L4 (the error-run case asserts `run.durationMs >= 0`).

---

## IPC — `src/main/ipc/runs.ts`
**Status:** not unit-tested (Electron-coupled).

| # | Case | Expected |
| --- | --- | --- |
| O-I1 | `runs:list` with no filter returns recent | newest-first list |
| O-I2 | `runs:list` with `ruleId` filters | only that rule's runs |
| O-I3 | `runs:get` returns one run | full record |
| O-I4 | `runs:trigger` enqueues + returns `{ runId }` | a run row appears |

---

## E2E / Manual

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| O-E1 | A run appears after Run-now | Run a rule; open Run history | row present ✅ existing (`playwright/observability.spec.ts`) |
| O-E2 | Detail panel shows prompt/result/toolCalls | Click a run row | three sections populated — **manual** (real `toolCalls` need live credentials) |
| O-E3 | Status badge matches parsed status | run signaling `done` | green "done" badge — **manual** (needs a successful run) |
| O-E4 | Error run shows error message | run without credentials | red status, error text in Result ✅ existing (`playwright/observability.spec.ts`) |
| O-E5 | Run durably recorded (re-fetchable via IPC) | trigger a run, then `window.api.runs.list` | the `error` run persists ✅ existing (`playwright/observability.spec.ts`) |

> O-E5's original intent (a one-line summary in `~/Library/Logs/LocalCortex/main.log`) can't be isolated in E2E: electron-log resolves that path through macOS Cocoa and ignores both `HOME` and `--user-data-dir`. The DB-backed run record — the isolatable, authoritative surface — is asserted instead. The file-log line itself remains a manual check.

---

## Related
- [Observability README](./README.md)
- [Stop conditions test-plan](../stop-conditions/test-plan.md)
- [design: §7 per-run flow](../../architecture.md#7-per-run-flow-end-to-end)
