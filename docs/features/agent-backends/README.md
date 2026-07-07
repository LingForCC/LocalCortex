# Agent Backends

Every rule declares which **agent** runs it: **Claude** (via `@anthropic-ai/claude-agent-sdk`) or **Codex** (via `@openai/codex-sdk`). Both are first-class — the difference is invisible to the rule text and to the rest of the app.

> Design: [architecture §5.5 (MCP config asymmetry)](../../architecture.md#55-mcp-config-asymmetry-between-backends), [§6.1 working directory](../../architecture.md#61-working-directory--first-class-rule-field).

---

## What the backend controls

The `AgentRunner` abstraction hides the two SDKs' differences behind one interface. What changes per backend:

| Concern | Claude | Codex |
| --- | --- | --- |
| MCP config | per-call: `options.mcpServers` | config file: `.codex/config.toml` in the workdir |
| Working dir | `options.cwd` | the workdir the SDK launches in |
| Approval (auto-execute) | `permissionMode: 'bypassPermissions'` | `approval_policy = "never"` in config.toml |
| Result usage | `usage.input_tokens` / `output_tokens` | `turn.usage.input_tokens` / `output_tokens` |

Everything else — staging the workdir, resolving MCP servers, building the prompt, recording the run, checking stop conditions — is **shared** and lives in the run-loop.

---

## Choosing Claude vs Codex

There's no behavioral difference from the app's perspective; pick based on which agent SDK you have credentials and a CLI for.

- **Claude** — set `ANTHROPIC_API_KEY` (and/or install Claude Code). MCP config is passed per-call; nothing is written to disk.
- **Codex** — set `OPENAI_API_KEY` and have the Codex CLI resolvable. MCP config is written to a per-run `.codex/config.toml` in the staged workdir, then **deleted at run teardown** (the file contains plaintext tokens — cleanup is security-critical).

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
4. **Agent run** — Claude streams `SDKMessage`s (assistant text, tool_use, result); Codex returns a `Turn` with items + finalResponse.
5. **Normalize** — both produce `{ text, toolCalls[], inputTokens, outputTokens, isError }`.
6. **Teardown** — Claude: no-op. Codex: **deletes the staged workdir** (removes the token-bearing config.toml).

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
The agent can draft edits in your repo for you to review. MCP config is staged into a per-run `.codex/` dir and removed when the run ends.

---

## Gotchas

- **Credentials are required to actually run.** Without `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` (and the respective CLI), clicking **Run** on a rule fails at agent spawn with a clear error. Creating/saving rules works without credentials.
- **Codex leaves tokens on disk during the run.** The per-run `.codex/config.toml` contains plaintext tokens. Teardown deletes it, but if a run is killed mid-flight (app crash, force-quit), the dir may survive under `~/.localcortex/runs/`. Inspect/clean manually if needed.
- **The result text is what the status parser scans.** Both backends' final text is fed to the [status-block parser](../stop-conditions/README.md). If an agent wraps the JSON in prose or omits it, stop detection falls back to structural backstops.

## Related
- [Rules](../rules/README.md) — `backend` is a rule field.
- [MCP sources](../mcp-sources/README.md) — how servers are attached per backend.
- [Stop conditions](../stop-conditions/README.md) — status parsing across both backends.
- [design: §5.5 backend asymmetry](../../architecture.md#55-mcp-config-asymmetry-between-backends).
