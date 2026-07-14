# localcortex-hook (Claude Code plugin)

Bridges Claude Code **session lifecycle** events into LocalCortex's local event
ingress. Once installed and enabled, this plugin runs hooks in **every**
Claude Code workspace — there is no per-project settings.json to maintain. It
registers two hooks:

- **Stop** → POSTs a `claude-code.session-complete` event when an agent turn ends.
- **UserPromptSubmit** → POSTs a `claude-code.prompt-submit` event
  when a user submits a prompt, so LocalCortex opens the **handoff-attach popup**.

This is the Claude Code counterpart to `packaging/zcode-hook-plugin/`, which
bridges the same events for ZCode. The two ship as separate marketplace
plugins with distinct event types (`claude-code.*` vs `zcode.*`) so LocalCortex
can tell the sources apart in event rules.

## What it does

Both hooks POST a small JSON payload to LocalCortex's loopback ingress
(`http://127.0.0.1:4729/event` by default). The same bridge script serves both;
the `UserPromptSubmit` registration sets `LC_EVENT_TYPE=claude-code.prompt-submit` to
emit the prompt-submit event type (default is `claude-code.session-complete`):

```json
{
  "type": "claude-code.session-complete",   // or "claude-code.prompt-submit"
  "source": "claude-code",
  "timestamp": "<UTC ISO-8601>",
  "payload": {
    "sessionId": "<Claude Code session id>",
    "workdir": "<current working directory>",
    "summary": "<optional, from $LC_SUMMARY>"
  }
}
```

Any event rule matching `claude-code.session-complete` (for example, a "create
a review subtask" handoff rule) can then react. The `claude-code.prompt-submit`
event opens the attach popup (see `docs/features/handoffs/README.md` →
"Prompt-submit prompt") and — like any event type — can also drive event rules
that match it. The hook is fire-and-forget: if LocalCortex isn't running or the
ingress is down, the hook exits `0` and never fails the Claude Code session.

Claude Code passes session metadata (including `session_id` and `cwd`) to hooks
as JSON on stdin. The script reads that JSON and extracts `session_id`
(portable `sed` extractor — no `jq` dependency), falling back to the
`CLAUDE_SESSION_ID` env var if stdin is absent or unparseable. This mirrors
`src/main/events/codex-prompt-submit-hook.sh`.

## Install (local-directory marketplace)

1. In Claude Code, add this directory as a marketplace source:

   ```
   /claude-plugin marketplace add /Users/colin.liu/Repo/LocalCortex/packaging/claude-hook-plugin
   ```

   (Or via the interactive plugin manager, if your Claude Code version exposes
   one: add `/Users/colin.liu/Repo/LocalCortex/packaging/claude-hook-plugin` as a
   local marketplace source.)

2. Install the **localcortex-hook** plugin from that marketplace:

   ```
   /claude-plugin install localcortex-hook@localcortex-claude-hook
   ```

3. Make sure it is **enabled** (it's on by default after install).

That's it — both hooks are registered declaratively by `hooks/hooks.json`; there
is nothing to add to your user or project settings.

## Configuration (environment variables)

All optional. The hook uses these defaults:

| Variable | Default | Purpose |
| --- | --- | --- |
| `LC_HOST` | `127.0.0.1` | Ingress host |
| `LC_PORT` | `4729` | Ingress port |
| `LC_SECRET` | _(unset)_ | Sent as `x-localcortex-secret` header when set (see `docs/architecture.md` §8) |
| `LC_SESSION_ID` | _(unset)_ | Fallback if `session_id` isn't in stdin JSON and `CLAUDE_SESSION_ID` is unset |
| `LC_WORKDIR` | stdin `cwd`, else `$CLAUDE_PROJECT_DIR` or `$PWD` | Override the reported working directory |
| `LC_SUMMARY` | _(unset)_ | Optional summary string included in the payload |
| `LC_EVENT_TYPE` | `claude-code.session-complete` | Event type to POST. The `UserPromptSubmit` registration sets this to `claude-code.prompt-submit`; override only if you know what you're doing. |
| `LC_EVENT_SOURCE` | `claude-code` | Event `source` field |

## Structure

```
localcortex-hook/
├── .claude-plugin/plugin.json  # manifest (name + metadata)
├── hooks/hooks.json            # declarative Stop + UserPromptSubmit hooks
└── scripts/localcortex-hook.sh # the bridge script (curl-only, no deps)
```

`${CLAUDE_PLUGIN_ROOT}` resolves to this directory at runtime, so the script
reference is portable and needs no hardcoded path.
