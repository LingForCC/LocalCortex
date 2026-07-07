# Settings

Global defaults that apply across all rules. The **Settings** tab exposes five knobs: the default tick interval, the concurrency cap, an optional event-ingress shared secret, and optional explicit paths to the Codex / Claude Code CLIs.

> Design: [architecture §6.4 (concurrency)](../../architecture.md#64-concurrency--capped-parallelism), [§6.5 (cadence)](../../architecture.md#65-cadence--global-default--per-rule-override), [§6.5.1 (CLI resolution)](../../architecture.md#651-cli-resolution--local-vs-bundled-binary), [§8 (ingress security)](../../architecture.md#8-known-constraints--risks).

---

## The settings

| Setting | Default | What it controls |
| --- | --- | --- |
| **Default tick interval** | `3600` s (60 min) | Applied to tick rules that omit their own `intervalSeconds`. Minimum `300`. |
| **Concurrency cap** | `3` | Max agent runs executing at once, shared across the scheduler and the event ingress. |
| **Ingress shared secret** | none (unset) | If set, every POST to the event ingress must carry `x-localcortex-secret: <value>` or get HTTP 401. |
| **Codex CLI path** | none (auto-detect) | Explicit path to a locally installed `codex` binary. Leave blank to auto-detect on `PATH` (falls back to the SDK's bundled binary). |
| **Claude Code CLI path** | none (auto-detect) | Explicit path to a locally installed `claude` binary. Same resolution semantics as the Codex field. |

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

---

## Using the Settings view

1. Open the **Settings** tab.
2. Edit **Default tick interval** and/or **Concurrency cap**.
3. (Optional) set an **Ingress shared secret** — leave blank to disable auth.
4. (Optional) set **Codex CLI path** / **Claude Code CLI path** — leave blank to auto-detect on `PATH`.
5. Click **Save**.

Changes apply immediately: the concurrency cap takes effect for the next enqueued run; the tick default reschedules dependent rules on save; the secret gate applies to the next inbound event; a CLI path change applies to the next run.

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
