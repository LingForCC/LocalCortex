# Settings

Global defaults that apply across all rules. The **Settings** tab exposes the default tick interval, the concurrency cap, the appearance (light/dark/system), an optional event-ingress shared secret, optional explicit paths to the Codex / Claude Code CLIs, and the Codex model + reasoning-effort defaults.

> Design: [architecture §6.4 (concurrency)](../../architecture.md#64-concurrency--capped-parallelism), [§6.5 (cadence)](../../architecture.md#65-cadence--global-default--per-rule-override), [§6.5.1 (CLI resolution)](../../architecture.md#651-cli-resolution--local-vs-bundled-binary), [§8 (ingress security)](../../architecture.md#8-known-constraints--risks).

---

## The settings

| Setting | Default | What it controls |
| --- | --- | --- |
| **Default tick interval** | `3600` s (60 min) | Applied to tick rules that omit their own `intervalSeconds`. Minimum `300`. |
| **Concurrency cap** | `3` | Max agent runs executing at once, shared across the scheduler and the event ingress. |
| **Appearance** | `system` | Color scheme: `system` follows the OS preference; `light` / `dark` force one. Applies immediately on save. |
| **Ingress shared secret** | none (unset) | If set, every POST to the event ingress must carry `x-localcortex-secret: <value>` or get HTTP 401. |
| **Codex CLI path** | none (auto-detect) | Explicit path to a locally installed `codex` binary. Leave blank to auto-detect on `PATH` (falls back to the SDK's bundled binary). |
| **Claude Code CLI path** | none (auto-detect) | Explicit path to a locally installed `claude` binary. Same resolution semantics as the Codex field. |
| **Codex model (default)** | `gpt-5.5` | Model id used when a Codex rule doesn't set its own `model`. Free-text (e.g. `gpt-5.6-sol`). |
| **Codex reasoning effort (default)** | `medium` | Applied to Codex rules that don't set their own effort (`minimal` / `low` / `medium` / `high` / `xhigh`). |
| **Handoff setup** | unset (onboarding required) | The three onboarding choices (`handoffAgentId`, `handoffTaskManagerId`, `handoffBackend`) plus the auto-created rule id (`handoffRuleId`). Managed by the [handoff setup](../handoff-setup/README.md) wizard; shown read-only in the Settings view with a reset button. |

Settings persist in the `app_settings` table and survive restarts.

---

## Default tick interval

```
rule.intervalSeconds  ??  settings.tickIntervalSeconds  ??  3600   (built-in)
```
clamped to ≥ 300. Changing the global default **reschedules** every tick rule that relies on it.

Because every tick is a full agent run, the interval is the **primary cost control** — lowering it raises token cost linearly with no steady-state savings. Keep it conservative (the 60-min default exists for this reason). A rule that needs to react faster should usually be an **event** rule, not a shorter tick.

## Concurrency cap

The scheduler and the event ingress share **one** capped-parallelism queue. When the in-flight count reaches the cap, further runs queue (FIFO) and execute as slots free up.

The cap bounds:
- **token spend** (no runaway cost after e.g. a network outage backfills many ticks at once), and
- **resource use** (subprocesses, MCP servers, memory).

Excess runs are not dropped — they wait. Setting it to `1` serializes all runs; the default `3` allows modest parallelism without overload.

## Appearance

The color scheme for the LocalCortex window. Three modes:

| Mode | Behavior |
| --- | --- |
| **System** *(default)* | Follows the OS color scheme. If your OS is in dark mode, LocalCortex is too; switch the OS and the app follows on its next paint. |
| **Light** | Forces a light window regardless of the OS setting. |
| **Dark** | Forces a dark window regardless of the OS setting. |

How it works: the main process sets Electron's `nativeTheme.themeSource` from this value and notifies the renderer of the *effective* scheme (`nativeTheme.shouldUseDarkColors`, which resolves `system` against the OS) over a `theme:apply` IPC channel. The renderer toggles a `.dark` class on `<html>`, and the theme tokens in `src/renderer/styles.css` (light defaults on `:root` + dark overrides under `.dark`) drive every shadcn primitive and the `body` background — so the whole UI flips with no per-component work.

> We use an explicit `.dark` class driven by `nativeTheme.shouldUseDarkColors` rather than the CSS `prefers-color-scheme` media query because Chromium's propagation of that query from `nativeTheme` is unreliable in the Electron runtime; `shouldUseDarkColors` is the authoritative signal.

The choice applies **immediately on save** (no restart): the `settings:update` handler re-applies `nativeTheme.themeSource` as soon as the value is persisted, and `system` mode also follows live OS theme changes via a `nativeTheme.on('updated')` listener. It persists across restarts like every other setting.

## Ingress shared secret

The event ingress binds to `127.0.0.1` only (loopback — not the network), but any process running as the user can still POST events and trigger runs (which under auto-execute means writes to your task manager). Setting a shared secret requires external hook scripts to include it in the `x-localcortex-secret` header.

- Configure the same value in the hook's environment (`LC_SECRET`) — see [Triggers](../triggers/README.md).
- Requests with the wrong or missing header get **HTTP 401**; every received event is logged regardless.

The blast radius of a forged event is still bounded by each rule's `mcpServers`, but the secret stops spurious runs from arbitrary local processes.

## Codex CLI path / Claude Code CLI path

By default each backend's SDK spawns a **bundled, vendored** native binary (resolved via `require.resolve` against a platform-specific npm package like `@openai/codex-darwin-arm64`). That means a globally installed `codex`/`claude` on your machine is **ignored** unless you opt in here. These two fields let you point the runners at your locally installed CLI instead.

Resolution order (same for both backends, in `agent/cli-resolver.ts`):

1. **Explicit path** from this Settings field, if set and non-empty.
2. **`PATH` auto-detect** — a `which`-style scan of `process.env.PATH` for the first executable match.
3. **SDK default** — if neither yields a path, the runner passes nothing and the SDK spawns its bundled binary (the default behavior).

Behavior notes:
- **Validated on save.** A non-empty path must exist and be executable (`fs.accessSync(path, X_OK)`); otherwise Save is rejected with an inline error in the Settings view. Empty is always allowed (means auto-detect / default).
- **No restart needed.** The runner provider re-reads Settings on every run, so a change takes effect on the next enqueued run.
- **Best-effort validation.** The check catches typos and missing files but can't guarantee the binary is the *right* one — a wrong-but-executable binary still spawns and fails at run time (surfaced in run history).

## Codex model / reasoning effort (defaults)

The Codex backend takes two model-level knobs: the **model id** (free-text, e.g. `gpt-5.5`) and the **reasoning effort** (`minimal` / `low` / `medium` / `high` / `xhigh`). Both have an **app-level default** set here, and an optional **per-rule override** (see [Rules](../rules/README.md)).

Resolution at run time:
```
model              = rule.model              ?? settings.codexModel              (default: gpt-5.5)
reasoningEffort    = rule.modelReasoningEffort ?? settings.codexReasoningEffort  (default: medium)
```

This mirrors the tick-interval fallback: a rule that leaves the field blank always uses whatever the current app default is. So changing the app default immediately affects every rule that doesn't override it — including the [auto-created handoff rule](../handoff-setup/README.md), which leaves both fields blank and inherits by design.

Notes:
- **Codex-only.** The Claude backend ignores both fields.
- **Model is free-text.** New model ids work without a code change, but the Codex binary/SDK must support the id or the run fails with an API error (surfaced in run history). If you point `codexCliPath` at an older bundled binary, pick a model it knows.
- **`xhigh` ≈ the desktop app's "ultra".** The SDK's enum is `minimal` / `low` / `medium` / `high` / `xhigh`; there is no `ultra` value. Your global `~/.codex/config.toml` is still respected as a base layer, but an explicit value here (or on the rule) overrides it for the run.

---

## Using the Settings view

1. Open the **Settings** tab.
2. Edit **Default tick interval** and/or **Concurrency cap**.
3. (Optional) choose an **Appearance** — `System` follows your OS.
4. (Optional) set an **Ingress shared secret** — leave blank to disable auth.
5. (Optional) set **Codex CLI path** / **Claude Code CLI path** — leave blank to auto-detect on `PATH`.
6. (Optional) set the **Codex model** / **Codex reasoning effort** defaults — applied to any Codex rule that doesn't override them.
7. Click **Save**.

Changes apply immediately: the concurrency cap takes effect for the next enqueued run; the tick default reschedules dependent rules on save; the secret gate applies to the next inbound event; a CLI path change applies to the next run; the appearance takes effect on the next paint.

---

## Gotchas
- **Tick interval is a cost dial, not a speed dial.** Don't lower it to make a rule "faster" — convert the rule to event-triggered instead. Every tick is a full agent run regardless of whether anything changed.
- **Concurrency `1` serializes everything.** A long-running rule will block all others (including event-triggered ones) until it finishes.
- **Changing the secret invalidates running hooks** until they're updated with the new value — events will 401 in the meantime.
- **An empty CLI path is not "no CLI".** It means auto-detect on `PATH`, then fall back to the bundled binary. To force the bundled binary when a `codex`/`claude` exists on your `PATH`, there is currently no separate toggle — the explicit path wins if set.

## Related
- [Triggers](../triggers/README.md) — tick cadence + the ingress the secret protects.
- [Agent backends](../agent-backends/README.md) — the two runners these CLI paths feed.
- [Stop conditions](../stop-conditions/README.md) — per-rule backstops (settings holds no maxRuns override today).
- [design: §6.4 concurrency](../../architecture.md#64-concurrency--capped-parallelism), [§6.5 cadence](../../architecture.md#65-cadence--global-default--per-rule-override), [§6.5.1 CLI resolution](../../architecture.md#651-cli-resolution--local-vs-bundled-binary).
