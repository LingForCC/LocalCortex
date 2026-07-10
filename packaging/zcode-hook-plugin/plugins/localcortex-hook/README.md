# localcortex-hook (ZCode plugin)

Bridges ZCode **session lifecycle** events into LocalCortex's local event
ingress. Once installed and enabled, this plugin runs hooks in **every** ZCode
workspace — there is no per-project `config.json` to maintain. It registers two
hooks:

- **Stop** → POSTs a `zcode.session-complete` event when an agent turn ends.
- **UserPromptSubmit** → POSTs a `zcode.prompt-submit` event
  when a user submits a prompt, so LocalCortex opens the **handoff-attach popup**.

## What it does

Both hooks POST a small JSON payload to LocalCortex's loopback ingress
(`http://127.0.0.1:4729/event` by default). The same bridge script serves both;
the `UserPromptSubmit` registration sets `LC_EVENT_TYPE=zcode.prompt-submit` to emit
the prompt-submit event type (default is `zcode.session-complete`):

```json
{
  "type": "zcode.session-complete",   // or "zcode.prompt-submit"
  "source": "zcode",
  "timestamp": "<UTC ISO-8601>",
  "payload": {
    "sessionId": "<ZCode session id>",
    "workdir": "<current working directory>",
    "summary": "<optional, from $LC_SUMMARY>"
  }
}
```

Any event rule matching `zcode.session-complete` (for example, a "create a
review subtask" handoff rule) can then react. The `zcode.prompt-submit` event
opens the attach popup (see `docs/features/handoffs/README.md` → "Prompt-submit
prompt") and — like any event type — can also drive event rules that match it.
The hook is fire-and-forget: if LocalCortex isn't running or the ingress is
down, the hook exits `0` and never fails the ZCode session.

## Install (local-directory marketplace)

1. In **Settings → Plugin Management → Discover → `+`**, add this directory as a
   marketplace source:

   ```
   /Users/colin.liu/Repo/LocalCortex/packaging/zcode-hook-plugin
   ```

2. Install the **localcortex-hook** plugin from that marketplace.
3. Make sure it is **enabled** (it's on by default after install). Plugin
   enable/disable state lives under `plugins` in `~/.zcode/cli/config.json`.

That's it — both hooks are registered declaratively by `hooks/hooks.json`; there
is nothing to add to your user or workspace config.

## Configuration (environment variables)

All optional. The hook uses these defaults:

| Variable | Default | Purpose |
| --- | --- | --- |
| `LC_HOST` | `127.0.0.1` | Ingress host |
| `LC_PORT` | `4729` | Ingress port |
| `LC_SECRET` | _(unset)_ | Sent as `x-localcortex-secret` header when set (see `docs/architecture.md` §8) |
| `LC_SESSION_ID` | _(unset)_ | Fallback if `CLAUDE_SESSION_ID` isn't exposed |
| `LC_WORKDIR` | `$ZCODE_PROJECT_DIR` or `$PWD` | Override the reported working directory |
| `LC_SUMMARY` | _(unset)_ | Optional summary string included in the payload |
| `LC_EVENT_TYPE` | `zcode.session-complete` | Event type to POST. The `UserPromptSubmit` registration sets this to `zcode.prompt-submit`; override only if you know what you're doing. |
| `LC_EVENT_SOURCE` | `zcode` | Event `source` field |

## Structure

```
localcortex-hook/
├── .zcode-plugin/plugin.json   # manifest (name + metadata)
├── hooks/hooks.json            # declarative Stop + UserPromptSubmit hooks
└── scripts/localcortex-hook.sh # the bridge script (curl-only, no deps)
```

`${CLAUDE_PLUGIN_ROOT}` resolves to this directory at runtime, so the script
reference is portable and needs no hardcoded path.

## Replacing the old user-scope hook

This plugin supersedes the previous manual setup, which required editing
`~/.zcode/cli/config.json` and keeping a script at
`~/.zcode/cli/scripts/localcortex-hook.sh`. After installing this plugin you can
remove that `hooks` block and delete the old script.
