# Stop Conditions

Without a stop condition, every rule runs forever — including a one-off like "remind me to merge MR !23494," which would keep re-fetching and re-evaluating long after the MR merged, burning tokens each cycle. LocalCortex uses **two complementary mechanisms** to stop rules: agent-signaled completion (primary) and structural backstops (floor).

> Design: [architecture §6.6 (stop conditions)](../../architecture.md#66-stop-conditions--agent-signaled-completion--structural-backstop).

---

## 1. Agent-signaled completion (primary)

Only the agent understands the rule's intent (it's natural language), so only it can judge "is this rule's goal achieved?" The prompt contract requires the agent to emit a machine-readable status block at the end of each run:

```json
{"status": "done", "reason": "MR !23494 was merged; reminder task created."}
```

The app parses this from the transcript and acts:

| `status` | Meaning | App action |
| --- | --- | --- |
| `active` | Goal not yet met; keep firing. | continue scheduling |
| `done` | Goal achieved or no longer relevant. | **disable** the rule (`enabled=false`), record the reason. |
| `error` | Could not complete (auth failure, item not found). | **disable** the rule, surface the error. |

The status contract is **app-authored** — appended to every prompt automatically. You never write it in the rule text. See [design: prompt contract](../../rule-config-schema.md#2-rule--natural-language-instruction).

### Parsing is lenient
The parser scans the **whole** transcript for the first valid block (not just the last line), tolerating extra whitespace and fields, skipping malformed JSON and non-status JSON objects. If no block is found, the rule stays `active` and relies on the backstops below. See [Observability](../observability/README.md) for how the parsed status is recorded.

---

## 2. Structural backstops (floor)

Optional per-rule fields bound waste regardless of whether the agent ever signals `done`:

| Field | Default | Meaning |
| --- | --- | --- |
| `maxRuns` | global default (**48**, ≈2 days at 60-min cadence) | When the run count reaches this, disable with "max runs reached". Set to `null` for unlimited. |
| `expiresAt` | none | ISO timestamp after which the rule auto-disables. |

If both are set, **whichever triggers first** disables the rule. These catch the case where the agent never decides to stop (a stalled MR that never merges) or where the status block fails to parse.

### `maxRuns` semantics per trigger
- **Tick rule** with `maxRuns: 48` → runs up to 48 times, then disables.
- **Event rule** with `maxRuns: 1` → a true **one-shot**: runs once on the first matching event, then disables.
- **Event rule** with `maxRuns: null` → reacts to every matching event indefinitely (a standing watch).

---

## Why both

- **Agent-signaled alone can fail silently** — the agent never emits `done` → runs forever.
- **Structural limits alone are dumb** — a rule that achieved its goal on run 1 still runs 47 more times.

Together they cover the realistic failure modes: intelligence where it works, a floor where it doesn't.

### Evaluation priority
When a run finishes, the stop-check evaluates in this order (first hit disables):
1. parsed status `done` or `error`
2. `expiresAt` in the past
3. `runCount >= effectiveMaxRuns`

The parsed status takes priority so a genuinely-done rule stops immediately rather than waiting on a backstop.

---

## Re-enabling

A rule disabled by _any_ mechanism can be re-enabled manually (toggle the **Enabled** switch). Re-enabling:
- **resets the run counter** to 0 (fresh start for `maxRuns`), and
- **clears the disable reason** (the reason is preserved in run history before being cleared).

The disable reason is shown under the rule's name in the rules table (e.g. "max runs reached (48)", "agent signaled done: MR merged"). Manual override always wins — you can re-enable regardless of how the rule was disabled.

---

## Gotchas

- **Parsing is the fragile link.** If the agent omits the block, emits malformed JSON, or buries it where the parser can't find it, `done` won't be detected and the rule keeps running until a backstop triggers (or forever if neither is set). Mitigation: keep `maxRuns` at a sensible default; the parser is lenient.
- **Ongoing rules don't deduplicate.** A rule whose status stays `active` indefinitely (e.g. "watch all my PRs") may create duplicate tasks each cycle — there's no cross-run write tracking. The status contract protects _one-off_ rules, not ongoing ones. See [design: §8](../../architecture.md#8-known-constraints--risks).
- **`maxRuns: null` is truly unbounded.** Only use it for event rules you want as standing watches, and rely on the agent signaling `done` when appropriate.

## Related
- [Rules](../rules/README.md) — `maxRuns` / `expiresAt` fields.
- [Observability](../observability/README.md) — the parsed status is recorded per run.
- [design: §6.6 stop conditions](../../architecture.md#66-stop-conditions--agent-signaled-completion--structural-backstop).
