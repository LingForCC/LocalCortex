-- Adds an optional column carrying per-task-manager "how to create a task"
-- instructions (MCP tool name + params). Interpolated into the handoff
-- profile's default review-subtask prompt so the agent knows the exact tool to
-- call instead of guessing from the attached server list. Null/empty falls back
-- to a generic "use the available MCP server" instruction.
--
-- Spec: docs/features/handoff-profiles/README.md.

ALTER TABLE task_managers ADD COLUMN create_task_instructions TEXT;

-- Seed the builtin OmniFocus row with the popular omnifocus-mcp tool name
-- (the package referenced by the builtin seed's setup_instructions). Other
-- managers stay null until the user fills the field in-app.
UPDATE task_managers
SET create_task_instructions =
  'Call mcp:omnifocus/add_omnifocus_task to create a new subtask under {{parentTaskId}} (pass parentTaskId = {{parentTaskId}}). Use {{parentTaskName}} for context if available. If the tool reports the parent was not found, retry with parentTaskName = {{parentTaskName}}.'
WHERE id = 'omnifocus';
