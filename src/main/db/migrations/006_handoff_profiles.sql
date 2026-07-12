-- handoff_profiles: a list of agent + task-manager + backend "handoff profiles".
--
-- Replaces the singleton onboarding model (one profile stored as four scalar
-- fields on app_settings + one fixed-id rule 'handoff-auto') with N
-- independently-configured profiles, each owning its own auto-created rule.
-- This lets the user run, e.g., a ZCode→OmniFocus profile and a
-- Codex→OmniFocus profile simultaneously: each profile's rule listens to its
-- agent's distinct session-complete event type, and the matcher fires every
-- matching rule.
--
-- Spec: docs/features/handoff-profiles/README.md. FK enforcement is ON
-- (DB_PRAGMAS), so agent/task-manager references are protected. rule_id uses
-- ON DELETE CASCADE: deleting a profile deletes its rule. agent_id /
-- task_manager_id use ON DELETE RESTRICT: a referenced catalog row must be
-- removed from profiles before it can be deleted from its own table.

CREATE TABLE IF NOT EXISTS handoff_profiles (
  id              TEXT PRIMARY KEY,
  label           TEXT NOT NULL,
  agent_id        TEXT NOT NULL,                     -- FK -> agents(id)
  task_manager_id TEXT NOT NULL,                     -- FK -> task_managers(id)
  backend         TEXT NOT NULL,                     -- 'claude' | 'codex'
  rule_id         TEXT NOT NULL,                     -- FK -> rules(id) (one rule per profile)
  enabled         INTEGER NOT NULL DEFAULT 1,        -- mirrors rule.enabled
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id)        REFERENCES agents(id)        ON DELETE RESTRICT,
  FOREIGN KEY (task_manager_id) REFERENCES task_managers(id) ON DELETE RESTRICT,
  FOREIGN KEY (rule_id)         REFERENCES rules(id)         ON DELETE CASCADE
);

-- Migrate any pre-existing singleton setup into one profile row, reusing the
-- existing 'handoff-auto' rule. The four handoff* keys lived as fields inside
-- the app_settings JSON blob under key 'app'. We read them with json_extract;
-- if any are missing/empty the setup was incomplete and we migrate nothing
-- (the user simply starts fresh in the Handoff profiles tab). We also require
-- the referenced rule row to still exist — SQLite FK violations are hard
-- errors (not caught by ON CONFLICT), so a missing rule would abort the whole
-- migration; guarding via the `IN (SELECT id FROM rules)` subquery lets a
-- broken/already-deleted-rule setup skip migration gracefully.
INSERT INTO handoff_profiles (id, label, agent_id, task_manager_id, backend, rule_id, enabled, created_at, updated_at)
SELECT
  'profile-handoff-auto',
  'Handoff (auto-created)',
  json_extract(value, '$.handoffAgentId'),
  json_extract(value, '$.handoffTaskManagerId'),
  json_extract(value, '$.handoffBackend'),
  COALESCE(json_extract(value, '$.handoffRuleId'), 'handoff-auto'),
  1,
  datetime('now'),
  datetime('now')
FROM app_settings
WHERE key = 'app'
  AND json_extract(value, '$.handoffAgentId') IS NOT NULL
  AND json_extract(value, '$.handoffAgentId') <> ''
  AND json_extract(value, '$.handoffTaskManagerId') IS NOT NULL
  AND json_extract(value, '$.handoffTaskManagerId') <> ''
  AND json_extract(value, '$.handoffBackend') IS NOT NULL
  AND json_extract(value, '$.handoffBackend') <> ''
  AND COALESCE(json_extract(value, '$.handoffRuleId'), 'handoff-auto') IN (SELECT id FROM rules);
