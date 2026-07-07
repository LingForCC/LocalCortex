# Features

User-facing documentation for LocalCortex's features — what each one does, how to use it, and how it's tested.

Each feature lives in its own subfolder with two files:

| File | Purpose |
| --- | --- |
| `README.md` | How the feature works from the operator's perspective: what it does, how to use it, gotchas, and worked examples. |
| `test-plan.md` | The test plan for the feature: in-scope behaviors, test types (unit / integration / E2E / manual), and pass/fail criteria. |

> These docs describe **features as implemented**. For the architectural rationale behind each design decision, see the [design docs](../) (`architecture.md`, `rule-config-schema.md`, `mcp-servers.md`, `tech-stack.md`).

---

## Feature index

| Feature | What it gives you |
| --- | --- |
| [**Rules**](./rules/README.md) | Define natural-language rules that an agent executes — the heart of the app. Create, edit, enable/disable, delete, run-now. |
| [**Triggers**](./triggers/README.md) | Two ways a rule fires: on a schedule (**tick**), or in response to a matching local HTTP event (**event**). Event payloads render into the rule as `{{template}}` variables. |
| [**Agent backends**](./agent-backends/README.md) | Choose whether **Claude** or **Codex** runs each rule. Both are first-class; the difference is invisible to the rule text. |
| [**MCP sources**](./mcp-sources/README.md) | Configure the external systems a rule can touch (GitHub, GitLab, Todoist, OmniFocus, …) in one user-editable file. Placeholder-token detection prevents run failures. |
| [**Observability (run history)**](./observability/README.md) | Every run is recorded — prompt, tool calls, token cost, duration, result, and the parsed status. The safety net under auto-execute. |
| [**Stop conditions**](./stop-conditions/README.md) | How rules stop themselves: the agent emits a `done`/`error` status, or structural backstops (`maxRuns`, `expiresAt`) catch the rest. |
| [**Settings**](./settings/README.md) | Global defaults: the tick interval applied when a rule omits its own, the concurrency cap, and an optional event-ingress shared secret. |

---

## How to read these docs

- **Start with [Rules](./rules/README.md)** — every other feature is a facet of how a rule is defined or how it runs.
- Each `README.md` ends with a **"Related"** section linking to the dependencies and design docs that back it.
- Each `test-plan.md` lists the **existing automated coverage** (file + test counts) followed by the cases that still need manual or E2E verification.
