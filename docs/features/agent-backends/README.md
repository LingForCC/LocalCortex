# Agent Backends

Every rule declares which **agent** runs it: **Claude** (via `@anthropic-ai/claude-agent-sdk`) or **Codex** (via `@openai/codex-sdk`). Both are first-class — the difference is invisible to the rule text and to the rest of the app.

> Design: [architecture §5.5 (MCP config asymmetry)](../../architecture.md#55-mcp-config-asymmetry-between-backends), [§6.1 working directory](../../architecture.md#61-working-directory--first-class-rule-field).

---

## What the backend controls

The `AgentRunner` abstraction hides the two SDKs' differences behind one interface. What changes per backend:

| Concern | Claude | Codex |
| --- | --- | --- |
| MCP config | per-call: `options.mcpServers` | config file: `.codex/config.toml` in the workdir |
| Working dir | `options.cwd` (honors `rule.workdir`) | ephemeral staged dir (`~/.localcortex/runs/<rule-id>/<ts>/`); `rule.workdir` is **ignored** (see [Limitations](#limitations-codex)) |
| Approval (auto-execute) | `permissionMode: 'bypassPermissions'` | `approval_policy = "never"` in config.toml |
| CLI binary override | `pathToClaudeCodeExecutable` | `codexPathOverride` |
| Result usage | `usage.input_tokens` / `output_tokens` | `usage.input_tokens` / `output_tokens` (on the `turn.completed` event) |

Everything else — staging the workdir, resolving MCP servers, building the prompt, recording the run, checking stop conditions — is **shared** and lives in the run-loop.

---

## Choosing Claude vs Codex

There's no behavioral difference from the app's perspective; pick based on which agent SDK you have credentials and a CLI for.

- **Claude** — set `ANTHROPIC_API_KEY` (and/or install Claude Code). MCP config is passed per-call; nothing is written to disk.
- **Codex** — set `OPENAI_API_KEY` and have the Codex CLI resolvable. MCP config is written to a per-run `.codex/config.toml` in the staged workdir, then **deleted at run teardown** (the file contains plaintext tokens — cleanup is security-critical).

### Which CLI binary runs?

By default each backend's SDK spawns its own **bundled, vendored** binary (resolved from a platform-specific npm package), so a globally installed `codex`/`claude` on your machine is **ignored**. To run against your locally installed CLI instead, set **Codex CLI path** / **Claude Code CLI path** in [Settings](../settings/README.md) (or leave blank to auto-detect on `PATH`). See [design: §6.5.1 CLI resolution](../../architecture.md#651-cli-resolution--local-vs-bundled-binary).

> **Codex is the harder path.** Config-file MCP + workdir staging mean the Codex runner carries more complexity. See [design: known constraints §8](../../architecture.md#8-known-constraints--risks).

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

1. **Staging** — Claude: ensures `workdir` exists (per-call config, nothing written). Codex: creates `~/.localcortex/runs/<rule-id>/<timestamp>/` and writes `.codex/config.toml` with the resolved MCP servers + `approval_policy = "never"`.
2. **MCP resolution + placeholder check** — both: servers resolved from `mcp-servers.json`; run fails fast if any env value is still `<your-token-here>`.
3. **Prompt** — identical for both (rendered rule + status contract + tool list).
4. **Agent run** — both backends stream. Claude iterates `SDKMessage`s (assistant text, `tool_use`, result); Codex iterates the `runStreamed()` event stream (`item.completed`, `turn.completed`, …). Each runner normalizes its stream into the same result and optionally emits intermediate progress events (tool calls, assistant text) to the run-loop for live logging (see [Observability → Logging](../observability/README.md#logging-main-process)).
5. **Normalize** — both produce `{ text, toolCalls[], inputTokens, outputTokens, isError }`.
6. **Teardown** — Claude: no-op. Codex: **deletes the staged workdir** (removes the token-bearing config.toml).

---

## Limitations (Codex)

The Codex SDK reads MCP config **only** from a `.codex/config.toml` in the directory it launches in (§5.5) — there is no per-call API. That file contains plaintext tokens, and teardown is best-effort (a `finally` block; does not run on crash/`SIGKILL`/force-quit). Writing it into a user-chosen `rule.workdir` would risk polluting a real project, clobbering a pre-existing `.codex/config.toml`, and leaking committed tokens if teardown failed. Two consequences follow:

1. **`rule.workdir` is ignored for Codex.** Every Codex run launches in an ephemeral staged dir (`~/.localcortex/runs/<rule-id>/<timestamp>/`), never in the user's `workdir`. Claude honors `rule.workdir`; Codex does not.
2. **Codex cannot persist filesystem changes.** The staged cwd is deleted at teardown, so any files the agent writes to its working directory are wiped at run end. A Codex rule that needs to create or modify files in a real project must do so through MCP server tools that target absolute paths. For "draft edits in my repo" workflows, use Claude.

A future iteration may honor `rule.workdir` for Codex by writing then restoring a `config.toml` inside it (handling pre-existing config + gitignore), but this is deferred. See [architecture.md §6.1](../../architecture.md#61-working-directory--first-class-rule-field) and [§8](../../architecture.md#8-known-constraints--risks).

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
> **`workdir` is ignored for Codex** (see [Limitations](#limitations-codex) below). The agent runs in an ephemeral staged directory that is deleted at teardown, so it **cannot** draft filesystem edits into `/Users/colin/code/web-app` — any files written to its cwd vanish at run end. To create or modify files in a real project, the rule must do so through MCP server tools that target absolute paths. For drafting changes directly in a repo, use Claude (which honors `workdir`).

---

## Gotchas

- **Credentials are required to actually run.** Without `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` (and the respective CLI), clicking **Run** on a rule fails at agent spawn with a clear error. Creating/saving rules works without credentials.
- **Codex leaves tokens on disk during the run.** The per-run `.codex/config.toml` contains plaintext tokens. Teardown deletes it, but if a run is killed mid-flight (app crash, force-quit), the dir may survive under `~/.localcortex/runs/`. Inspect/clean manually if needed.
- **Codex ignores `rule.workdir`.** See [Limitations (Codex)](#limitations-codex) above — a Codex rule runs in an ephemeral staged dir, not the declared `workdir`, and cannot persist filesystem writes.
- **The result text is what the status parser scans.** Both backends' final text is fed to the [status-block parser](../stop-conditions/README.md). If an agent wraps the JSON in prose or omits it, stop detection falls back to structural backstops.

## Related
- [Rules](../rules/README.md) — `backend` is a rule field.
- [MCP sources](../mcp-sources/README.md) — how servers are attached per backend.
- [Settings](../settings/README.md) — `codexCliPath` / `claudeCliPath` pin which CLI binary each backend spawns.
- [Stop conditions](../stop-conditions/README.md) — status parsing across both backends.
- [design: §5.5 backend asymmetry](../../architecture.md#55-mcp-config-asymmetry-between-backends), [§6.5.1 CLI resolution](../../architecture.md#651-cli-resolution--local-vs-bundled-binary).
