# localcortex-hook (Codex Desktop plugin)

Bridges Codex lifecycle events into LocalCortex's loopback event ingress. Once
installed, enabled, and trusted, the plugin runs in every local Codex workspace;
there is no per-project hooks file to maintain.

It registers two lifecycle hooks:

- **UserPromptSubmit** posts a `codex.prompt-submit` event so LocalCortex can
  open its handoff-attach popup.
- **Stop** posts a `codex.session-complete` event when a Codex turn ends so
  matching LocalCortex rules can react.

## Event payload

Both hooks post to `http://127.0.0.1:4729/event` by default:

```json
{
  "type": "codex.session-complete",
  "source": "codex",
  "timestamp": "<UTC ISO-8601>",
  "payload": {
    "sessionId": "<Codex session id>",
    "workdir": "<session working directory>",
    "summary": "<last assistant message for Stop>"
  }
}
```

For `UserPromptSubmit`, `type` is `codex.prompt-submit` and
`summary` is empty. The user's prompt text is deliberately not forwarded.

Codex supplies the session id, working directory, and Stop summary as JSON on
stdin. The bridge parses those values, converts them to LocalCortex's event
shape, and exits successfully even when LocalCortex is not running.

## Install

From the LocalCortex repository root, add the bundled marketplace and install
the plugin:

```bash
codex plugin marketplace add ./packaging/codex-hook-plugin
codex plugin add localcortex-hook@localcortex-codex-hook
```

Start a new Codex task after installation. Codex does not automatically trust
plugin-bundled hooks: review and trust this plugin's two command hooks with
`/hooks` before expecting events to arrive. Codex will ask for review again
if the hook definition changes.

## Configuration

All variables are optional:

| Variable          | Default                  | Purpose                                   |
| ----------------- | ------------------------ | ----------------------------------------- |
| `LC_HOST`         | `127.0.0.1`              | LocalCortex ingress host                  |
| `LC_PORT`         | `4729`                   | LocalCortex ingress port                  |
| `LC_SECRET`       | unset                    | Sent as the `x-localcortex-secret` header |
| `LC_SESSION_ID`   | hook stdin               | Override the Codex session id             |
| `LC_WORKDIR`      | hook stdin / `$PWD`      | Override the reported working directory   |
| `LC_SUMMARY`      | Stop hook stdin          | Override the completion summary           |
| `LC_EVENT_TYPE`   | `codex.session-complete` | Override the emitted event type           |
| `LC_EVENT_SOURCE` | `codex`                  | Override the event source                 |

The hook uses Bash and curl. On macOS it uses the system `plutil` command to
decode Codex's JSON input; elsewhere it uses Python 3 or jq when available.
Without a JSON decoder, the explicit `LC_*` variables and `$PWD` remain safe
fallbacks.

## Structure

```text
localcortex-hook/
├── .codex-plugin/plugin.json   # Codex plugin manifest
├── hooks/hooks.json            # Stop + UserPromptSubmit hooks
└── scripts/localcortex-hook.sh # fire-and-forget ingress bridge
```

`PLUGIN_ROOT` resolves to the installed plugin directory at hook runtime, so
the command contains no checkout-specific absolute path.
