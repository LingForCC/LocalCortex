# MCP Servers (deprecated)

> ⚠️ **This document is deprecated.** It describes the **retired file-based**
> MCP server model (`~/.localcortex/mcp-servers.json`), which has been replaced
> by the **DB-backed `mcp_servers` SQLite table**.
>
> The authoritative reference is now
> **[`docs/features/mcp-sources/README.md`](./features/mcp-sources/README.md)** —
> it covers the current config format, seeded defaults, the Sources-tab CRUD UI,
> the name-resolution algorithm, per-backend serialization, and the security
> posture. The content below is kept solely as a historical record of the old
> design; it does **not** reflect the current implementation.

---

## What changed, and why

The static `~/.localcortex/mcp-servers.json` file has been **retired**. MCP
server configs now live in the `mcp_servers` DB table, created and seeded by
migration `004_catalog.sql` and edited in-app through the **Sources** tab.

| | Old (this doc) | Current |
| --- | --- | --- |
| Source of truth | `~/.localcortex/mcp-servers.json` (user-edited file) | `mcp_servers` SQLite table (edited via Sources tab) |
| Seeded defaults | 3 servers (`github`, `gitlab`, `todoist`), placeholder tokens | 4 servers (`github`, `gitlab`, `todoist`, `omnifocus`) |
| Runtime resolution | load + lookup the JSON file | `McpServersRepository.getAsConfig()` → `resolveMcpServers()` |
| First-run behavior | write bundled default to the file | run migration 004 (seed); one-time legacy `importFromFile` |
| Add a server | edit the JSON file | Sources tab → Form or JSON-paste mode |

**Upgrade path:** on first launch after upgrade, a one-time import reads any
existing `mcp-servers.json` and inserts its servers into the table (real tokens
preserved, placeholders overwritten). The file is no longer needed after import.

## Still-valid concepts (moved to the new doc)

The following content from the original document was conceptually still
accurate and has been carried over to
[`docs/features/mcp-sources/README.md`](./features/mcp-sources/README.md):

- Name-based referencing — rules reference servers by name only; names are
  arbitrary aliases.
- Per-backend serialization — Claude consumes an in-memory `options.mcpServers`
  dict; Codex consumes `options.config` flattened into `--config` flags. This
  logic is **unchanged** and operates on the same config object shape.
- Placeholder validation — runs fail fast if a referenced server still holds the
  `<your-token-here>` placeholder token.
- Security posture — plaintext tokens, spawn-time-only credential delivery,
  per-run respawn, and Codex's CLI-arg token surface. (The threat model is
  unchanged; only the storage location moved from a `0600` file to the SQLite
  DB in Electron's userData directory.)

For the **worked end-to-end example**, **resolution algorithm**, and
**expanded security notes**, see the new doc.

## What is no longer accurate

Everything tied to the file mechanism is obsolete and should not be relied on:

- §2 "Config file format" — the JSON file no longer exists at runtime.
- §3 "Default config (shipped)" — defaults are now seeded by migration 004 (and
  include `omnifocus`); the bundled-default write-on-first-launch behavior is
  gone.
- §4 "Resolution algorithm" — the resolver now reads the DB-backed config object
  via `getAsConfig()`, not the file.
- §7 "Adding a new MCP server" — servers are added via the Sources tab, not by
  editing the JSON file.
- §8 "Security notes" references to the `0600` config file — replaced by the DB
  storage posture documented in the new reference.
- §9 "Open questions" — hot-reload is now solved (the run-loop reads the DB per
  run, so Sources-tab edits take effect on the next run with no restart).
