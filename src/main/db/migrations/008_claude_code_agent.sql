-- Seed the `claude-code` builtin coding agent into the `agents` catalog.
--
-- The Claude Code agent backend (the SDK runner) already exists; this migration
-- adds Claude Code as a first-class *event source* — the catalog row that makes
-- it appear alongside ZCode and Codex in the Handoff profiles → "Coding agent"
-- picker. The event types + source mirror exactly what the shipped Claude Code
-- hook plugin emits (packaging/claude-hook-plugin/.../hooks.json +
-- scripts/localcortex-hook.sh), so ingress/matcher/popup wire up automatically.
--
-- INSERT OR IGNORE: if a user already added a custom `claude-code` row by hand,
-- their configuration is left untouched (PK = id).
INSERT OR IGNORE INTO agents (id, label, description, session_complete_event_type, prompt_submit_event_type, source, install_instructions, is_builtin) VALUES
  ('claude-code',
   'Claude Code',
   'Anthropic Claude Code CLI agent. Emits session events via the LocalCortex Claude Code hook plugin (packaging/claude-hook-plugin/).',
   'claude-code.session-complete',
   'claude-code.prompt-submit',
   'claude-code',
   'Install the localcortex-hook Claude Code plugin (see packaging/claude-hook-plugin/). It registers Stop and UserPromptSubmit hooks that POST events to LocalCortex automatically. No env vars needed if LocalCortex runs on the default port.',
   1);
