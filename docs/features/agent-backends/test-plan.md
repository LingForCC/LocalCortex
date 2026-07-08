# Agent Backends — Test Plan

Covers the **`AgentRunner` abstraction**, the **Claude** and **Codex** runner implementations, and **workdir staging**. Both backends pass MCP config per-call (Claude via `options.mcpServers`, Codex via `options.config` → `--config` flags), so staging writes nothing to disk.

Real agent execution is **not** unit-tested (it needs live API keys + CLIs and is non-deterministic — see [tech-stack §5](../../tech-stack.md#5-testing-strategy)). The contract is verified through the run-loop with a **stub runner**, and the SDK-coupled code is type-checked and structurally exercised.

---

## In scope
- `AgentRunner` interface + `RunInput`/`RunResult` shapes.
- Per-backend config serialization (Claude `mcpServers`, Codex `options.config` object).
- Codex receives resolved servers per-call (via `input.servers`).
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
**Status:** ✅ covered — 9 cases. Uses an in-memory DB + a stub `AgentRunner` returning canned transcripts, so the full enqueue → stage → resolve → prompt → run → record → stop-check path is exercised without any SDK.

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

> A-U6 vs A-U7 together fix the `executeRun` contract: **setup** problems (missing rule, undefined MCP server, placeholder tokens at spawn) throw before there's anything to record; an **agent-side** failure (e.g. missing API key) is recorded as an `error` run so it shows up in Run history — the safety net under auto-execute.

### Config serialization — `src/main/mcp/config.test.ts`
**Status:** ✅ covered — 12 cases (see [MCP sources test-plan](../mcp-sources/test-plan.md)). Includes the Codex `options.config` object shape (`mcp_servers.<name>` with command/args/env), the legacy TOML serializer, and placeholder detection that both runners depend on.

---

## Type-safety gate (whole project)

Both runners import their respective SDKs and are type-checked end-to end:
- `src/main/agent/claude.ts` — `query()`, `Options`, streaming `SDKMessage`, usage extraction.
- `src/main/agent/codex.ts` — `Codex`/`Thread`/`Turn`, `sandboxMode`, `approvalPolicy: 'never'`, `skipGitRepoCheck`.

`tsc --noEmit` passing is the bar that the SDK-coupled code compiles against the real SDK surfaces.

---

## Manual test plan (requires credentials)

Prep: set `ANTHROPIC_API_KEY` (Claude) and/or `OPENAI_API_KEY` (Codex); fill tokens in `~/.localcortex/mcp-servers.json`.

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

---

## Related
- [Agent backends README](./README.md)
- [design: §5.5 backend asymmetry](../../architecture.md#55-mcp-config-asymmetry-between-backends), [§6.1 working dir](../../architecture.md#61-working-directory--first-class-rule-field)
