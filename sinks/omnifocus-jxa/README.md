# @localcortex/omnifocus-jxa

A minimal MCP (Model Context Protocol) server that wraps OmniFocus via **JXA**
(JavaScript for Automation). Spawned as a stdio child process by LocalCortex
rules that need to write to OmniFocus.

See [docs/architecture.md §5.3](../../../docs/architecture.md#53-omnifocus--custom-thin-jxa-wrapper).

## Tools

| Tool          | Purpose                                                  |
| ------------- | -------------------------------------------------------- |
| `create_task` | Create a task with name, note, and project               |
| `update_task` | Modify an existing task by id                            |
| `close_task`  | Mark a task complete by id                               |
| `find_tasks`  | Look up tasks by id or name substring (convenience read) |

Each tool shells out to `osascript -l JavaScript <script>`; the JXA scripts live
in `src/scripts/`.

## Why JXA over AppleScript strings

Omni's official scripting API, less escaping fragility, callable from Node via
`osascript -l JavaScript`. Owned because the community servers' AppleScript-string
approach is brittle, and a minimal, controlled surface is easier to keep reliable.

## Build & run

```bash
npm install
npm run build     # → dist/index.js + scripts/
node dist/index.js
```

In LocalCortex, this server is spawned per agent run (respawn-per-run isolation —
architecture.md §5.4). The default `mcp-servers.json` points the `omnifocus` entry
at `dist/index.js`.

## Constraints

- Single-machine only (talks to the local OmniFocus app).
- Process-spawn-per-call (one `osascript` per tool invocation). Slower than a REST
  sink; acceptable at the low write volumes LocalCortex targets (architecture.md §8).
