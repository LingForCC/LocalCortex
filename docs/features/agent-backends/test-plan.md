# Agent Backends — Test Plan

Covers the **`AgentRunner` abstraction**, the **Claude** and **Codex** runner implementations, and **workdir staging**. Both backends pass MCP config per-call (Claude via `options.mcpServers`, Codex via `options.config` → `--config` flags), so staging writes nothing to disk. The Codex runner also resolves **model** and **reasoning effort** — per-rule override falling back to the app-level default.

Real agent execution is **not** unit-tested end-to-end (it needs live API keys + CLIs and is non-deterministic — see [tech-stack §5](../../tech-stack.md#5-testing-strategy)). The contract is verified through the run-loop with a **stub runner**, and the Codex SDK surface (`startThread` options) is unit-tested with a `vi.mock`'d SDK. Live reasoning is manual spot-check only.

---

## In scope
- `AgentRunner` interface + `RunInput`/`RunResult` shapes.
- Per-backend config serialization (Claude `mcpServers`, Codex `options.config` object).
- Codex receives resolved servers per-call (via `input.servers`).
- Codex model + reasoning-effort resolution: `input.model ?? opts.model`, `input.reasoningEffort ?? opts.reasoningEffort` → `startThread({ model, modelReasoningEffort })`.
- Run-loop forwards per-rule `model`/`modelReasoningEffort` into `RunInput` (and `undefined` when the rule omits them).
- Placeholder-token check before spawn.

## Out of scope (verified elsewhere)
- Live Claude/Codex reasoning → manual spot-check only.
- Run-loop orchestration → covered by [Stop conditions](../stop-conditions/test-plan.md) + [Observability](../observability/test-plan.md) (the run-loop test uses a stub runner).

---

## Test types
| Type | Tool | Where |
| --- | --- | --- |
| Unit (pure logic) | Vitest | `src/**/*.test.ts` |
| Type safety | `tsc --noEmit` | whole project |
| Manual | operator + real API keys | — |

---

## Unit tests

### Run-loop with a stub runner — `src/main/agent/run-loop.test.ts`
**Status:** ✅ covered — 11 cases. Uses an in-memory DB + a stub `AgentRunner` returning canned transcripts, so the full enqueue → stage → resolve → prompt → run → record → stop-check path is exercised without any SDK.

| # | Case | Expected |
| --- | --- | --- |
| A-U1 | successful run + status parsed | ✅ existing |
| A-U2 | agent signals `done` → rule disabled | ✅ existing |
| A-U3 | agent signals `active` → rule stays enabled | ✅ existing |
| A-U4 | event payload renders into prompt | ✅ existing |
| A-U5 | **Codex: resolved servers passed per-call via `input.servers`** | ✅ existing |
| A-U5b | **Codex: `rule.workdir` honored as cwd** | ✅ existing |
| A-U6 | undefined MCP server → throws before run | ✅ existing |
| A-U7 | runner fails post-staging → recorded as an `error` run (no throw); setup failures still throw | ✅ existing |
| A-U8 | **Codex: per-rule `model` + `modelReasoningEffort` forwarded into `RunInput`** | `input.model='gpt-5.6-sol'`, `input.reasoningEffort='xhigh'` ✅ new |
| A-U9 | **Codex: rule with blank model/effort → `RunInput.model`/`.reasoningEffort` are `undefined`** (the runner then falls back to its constructor = app default) | both `undefined` ✅ new |

> A-U6 vs A-U7 together fix the `executeRun` contract: **setup** problems (missing rule, undefined MCP server, placeholder tokens at spawn) throw before there's anything to record; an **agent-side** failure (e.g. missing API key) is recorded as an `error` run so it shows up in Run history — the safety net under auto-execute.

> A-U8/A-U9 stop at the runner boundary. The Codex runner's own consumption of those fields is covered by A-U10..U14 below.

### Config serialization — `src/main/mcp/config.test.ts`
**Status:** ✅ covered — 12 cases (see [MCP sources test-plan](../mcp-sources/test-plan.md)). Includes the Codex `options.config` object shape (`mcp_servers.<name>` with command/args/env), the legacy TOML serializer, and placeholder detection that both runners depend on.

### Codex runner model + reasoning-effort resolution — `src/main/agent/codex.test.ts`

`CodexAgentRunner` resolves `input.model ?? this.opts.model` and `input.reasoningEffort ?? this.opts.reasoningEffort`, then conditionally spreads the resolved values into the `startThread({ model, modelReasoningEffort })` call. The SDK is mocked via `vi.mock('@openai/codex-sdk')` (same pattern as `ipc/handoffs.test.ts` mocks `electron`) so the runner is exercised without spawning the real binary. A spy on `startThread` captures the exact `ThreadOptions` object the runner builds.

**Status:** ✅ covered — `src/main/agent/codex.test.ts` (5 cases).

| # | Case | Expected |
| --- | --- | --- |
| A-U10 | per-run model + reasoningEffort passed into `startThread` | `opts.model='gpt-5.6-sol'`, `opts.modelReasoningEffort='xhigh'` ✅ new |
| A-U11 | falls back to constructor (app-level) defaults when the run omits them | `opts.model='gpt-5.5'`, `opts.modelReasoningEffort='medium'` ✅ new |
| A-U12 | per-run override wins over the constructor default | override values, not constructor values ✅ new |
| A-U13 | omits `model` and `modelReasoningEffort` from `startThread` when neither run nor default sets them | `opts` has neither key (conditional spread) ✅ new |
| A-U14 | partial override: model overridden, effort falls back to constructor (and vice versa) | overridden field wins; the other falls back ✅ new |

---

## Type-safety gate (whole project)

Both runners import their respective SDKs and are type-checked end-to end:
- `src/main/agent/claude.ts` — `query()`, `Options`, streaming `SDKMessage`, usage extraction.
- `src/main/agent/codex.ts` — `Codex`/`Thread`/`Turn`, `sandboxMode`, `approvalPolicy: 'never'`, `skipGitRepoCheck`, `model` + `modelReasoningEffort` (`ModelReasoningEffort`) on `startThread`.

`tsc --noEmit` passing is the bar that the SDK-coupled code compiles against the real SDK surfaces.

---

## Manual test plan (requires credentials)

Prep: set `ANTHROPIC_API_KEY` (Claude) and/or `OPENAI_API_KEY` (Codex); fill tokens in the Sources tab (the `mcp_servers` table).

### Claude
| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| A-M1 | Claude run executes | Create a tick rule, backend `claude`, run it | Run recorded as `success`; assistant text in result |
| A-M2 | Claude MCP tool call observed | Rule that must call an MCP server (e.g. fetch a GH PR) | `toolCalls[]` populated in run record |
| A-M3 | Claude token usage recorded | any successful run | `inputTokens`/`outputTokens` non-null |
| A-M4 | Claude read-only sandbox blocks write | rule with `sandbox:workspace-write` removed from `allowedTools` | agent can't write files in workdir |

### Codex
| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| A-M5 | Codex run executes | backend `codex`, run it | Run recorded `success` |
| A-M6 | **Codex receives MCP servers per-call** | run a Codex rule with a `todoist` server | agent can call todoist MCP tools (the original failing scenario — servers previously never reached Codex) |
| A-M7 | Codex honors `rule.workdir` | set `workdir` to a real path, run | agent's cwd is `rule.workdir` |
| A-M8 | Codex sandbox `read-only` blocks writes | `sandbox:read-only` | agent can't write files |
| A-M9 | **Codex uses app-default model** | Settings → set codexModel `gpt-5.5`, effort `medium`; create a Codex rule with blank model; run | run uses `gpt-5.5` / `medium` (check run-history prompt header or logs) ✅ new |
| A-M10 | **Codex per-rule model override** | same rule, set per-rule model `gpt-5.6-sol` + effort `xhigh`; run | run uses the override, not the app default ✅ new |
| A-M11 | **Changing the app default affects blank rules immediately** | change Settings codexModel; re-run the same blank rule (no edit) | run uses the new app default ✅ new |
| A-M12 | **Codex CLI binary must support the model id** | point `codexCliPath` at an older bundled binary; set model to a newer id; run | run fails with a clear API error in run history (the bundled binary's SDK rejects the model) ✅ new |

---

## Related
- [Agent backends README](./README.md)
- [design: §5.5 backend asymmetry](../../architecture.md#55-mcp-config-asymmetry-between-backends), [§6.1 working dir](../../architecture.md#61-working-directory--first-class-rule-field)
