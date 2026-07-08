# Agent Backends

Every rule declares which **agent** runs it: **Claude** (via `@anthropic-ai/claude-agent-sdk`) or **Codex** (via `@openai/codex-sdk`). Both are first-class — the difference is invisible to the rule text and to the rest of the app.

> Design: [architecture §5.5 (MCP config delivery)](../../architecture.md#55-mcp-config-delivery-between-backends), [§6.1 working directory](../../architecture.md#61-working-directory--first-class-rule-field).

---

## What the backend controls

The `AgentRunner` abstraction hides the two SDKs' differences behind one interface. What changes per backend:

| Concern | Claude | Codex |
| --- | --- | --- |
| MCP config | per-call: `options.mcpServers` | per-call: `options.config` → flattened to `--config key=value` flags |
| Working dir | `options.cwd` (honors `rule.workdir`) | `startThread` `workingDirectory` (honors `rule.workdir`) |
| Approval (auto-execute) | `permissionMode: 'bypassPermissions'` | `approvalPolicy: 'never'` (ThreadOptions) |
| CLI binary override | `pathToClaudeCodeExecutable` | `codexPathOverride` |
| Result usage | `usage.input_tokens` / `output_tokens` | `usage.input_tokens` / `output_tokens` (on the `turn.completed` event) |

Everything else — staging the workdir, resolving MCP servers, building the prompt, recording the run, checking stop conditions — is **shared** and lives in the run-loop.

---

## Choosing Claude vs Codex

There's no behavioral difference from the app's perspective; pick based on which agent SDK you have credentials and a CLI for.

- **Claude** — set `ANTHROPIC_API_KEY` (and/or install Claude Code). MCP config is passed per-call as an in-memory dict; nothing is written to disk.
- **Codex** — set `OPENAI_API_KEY` and have the Codex CLI resolvable. MCP config is passed per-call via `--config` flags, layered on top of your global `~/.codex/config.toml`; nothing is written to disk. (Note: credential values appear in the process's CLI args, visible via `ps` during the run.)

### Which CLI binary runs?

By default each backend's SDK spawns its own **bundled, vendored** binary (resolved from a platform-specific npm package), so a globally installed `codex`/`claude` on your machine is **ignored**. To run against your locally installed CLI instead, set **Codex CLI path** / **Claude Code CLI path** in [Settings](../settings/README.md) (or leave blank to auto-detect on `PATH`). See [design: §6.5.1 CLI resolution](../../architecture.md#651-cli-resolution--local-vs-bundled-binary).

---

## Sandbox (filesystem blast radius)

Independent of backend, `sandbox` bounds what the agent may do to the **filesystem** in `workdir`:

| `sandbox` | Meaning | Claude | Codex |
| --- | --- | --- | --- |
| `read-only` (default) | read files in workdir, no writes | `allowedTools` whitelist (Read/Grep/Glob/LS + `mcp__*`) | `sandboxMode: 'read-only'` |
| `workspace-write` | read/write within workdir (draft changes for review) | permissive tool set | `sandboxMode: 'workspace-write'` |

`sandbox` controls **filesystem** blast radius only. Writes to task managers happen through MCP servers and are governed by which servers are in `mcpServers`.

---

## How a run flows (per backend)

Both backends go through the same shared run-loop; only the spawn differs:

1. **Staging** — both backends: resolves the workdir (honoring `rule.workdir`, else a per-rule scratch dir) and ensures it exists. Nothing is written to disk (MCP config is per-call).
2. **MCP resolution + placeholder check** — both: servers resolved from `mcp-servers.json`; run fails fast if any env value is still `<your-token-here>`.
3. **Prompt** — identical for both (rendered rule + status contract + tool list).
4. **Agent run** — both backends stream. Claude iterates `SDKMessage`s (assistant text, `tool_use`, result); Codex iterates the `runStreamed()` event stream (`item.completed`, `turn.completed`, …). Each runner normalizes its stream into the same result and optionally emits intermediate progress events (tool calls, assistant text) to the run-loop for live logging (see [Observability → Logging](../observability/README.md#logging-main-process)).
5. **Normalize** — both produce `{ text, toolCalls[], inputTokens, outputTokens, isError }`.
6. **Teardown** — no-op for both (nothing token-bearing is written to disk).

---

## Notes (Codex)

MCP servers are passed per-call via `--config key=value` flags (§5.5), layered on top of your global `~/.codex/config.toml`. Two things to be aware of:

1. **Credentials appear in process args.** Token values ride as `--config mcp_servers.<name>.env.<TOKEN>=<value>`, so they're visible via `ps` for the run's duration. This is local to your own processes and ephemeral (no file persists), but it's a different surface than a `0600` file. Claude passes servers as an in-memory dict and never exposes them on the command line.
2. **Per-call overrides merge with your global Codex config.** If you declare a same-named MCP server in `~/.codex/config.toml`, the per-call override wins for that run. Auth (`~/.codex/auth.json`) is read from the normal config home and is unaffected.

---

## Worked examples

### Read-only triage (Claude)
```jsonc
{ "backend": "claude", "sandbox": "read-only", "workdir": "/Users/colin/code/web-app" }
```
The agent can read your repo and call MCP servers, but can't modify files. Good for "look at the diff, decide what I need to do, file a task."

### Draft changes for review (Codex)
```jsonc
{ "backend": "codex", "sandbox": "workspace-write", "workdir": "/Users/colin/code/web-app" }
```
The agent runs in `workdir` with workspace-write sandbox, so it can read and modify files there. MCP servers are attached per-call via `--config` flags.

---

## Gotchas

- **Credentials are required to actually run.** Without `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` (and the respective CLI), clicking **Run** on a rule fails at agent spawn with a clear error. Creating/saving rules works without credentials.
- **Codex exposes credentials in process args.** MCP server tokens pass as `--config mcp_servers.<name>.env.<TOKEN>=<value>` flags, visible via `ps` during the run. No token file is written to disk. Claude passes servers in-memory.
- **The result text is what the status parser scans.** Both backends' final text is fed to the [status-block parser](../stop-conditions/README.md). If an agent wraps the JSON in prose or omits it, stop detection falls back to structural backstops.

## Related
- [Rules](../rules/README.md) — `backend` is a rule field.
- [MCP sources](../mcp-sources/README.md) — how servers are attached per backend.
- [Settings](../settings/README.md) — `codexCliPath` / `claudeCliPath` pin which CLI binary each backend spawns.
- [Stop conditions](../stop-conditions/README.md) — status parsing across both backends.
- [design: §5.5 backend config delivery](../../architecture.md#55-mcp-config-delivery-between-backends), [§6.5.1 CLI resolution](../../architecture.md#651-cli-resolution--local-vs-bundled-binary).
