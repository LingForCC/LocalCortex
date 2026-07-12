-- Add per-rule Codex model + reasoning-effort override columns.
--
-- Both nullable with no default: a NULL means "inherit the app-level default"
-- (settings.codexModel / settings.codexReasoningEffort) resolved at run time.
-- Existing rows survive untouched (NULL), preserving the prior behavior of
-- letting the Codex runner's constructor default (the app setting) apply.
--
-- Spec: docs/features/rules/README.md (model / modelReasoningEffort fields).

ALTER TABLE rules ADD COLUMN model TEXT;
ALTER TABLE rules ADD COLUMN model_reasoning_effort TEXT;
