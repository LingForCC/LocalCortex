-- Handoffs: replace the fulfilled/pending/cancelled status model with an
-- enabled boolean (fire-on-every-match instead of fire-once).
--
-- Rationale: a coding-agent session often has multiple rounds of conversation,
-- each emitting a Stop event. The user may want the review reminder created
-- every round, not just the first. So "pending → fulfilled" becomes a simple
-- enabled/disabled toggle with no run-id tracking.
--
-- This migration rebuilds pending_reviews, preserving existing rows by mapping:
--   status='pending'    → enabled=1
--   status='fulfilled'  → enabled=0
--   status='cancelled'  → enabled=0
-- The rule_id / fulfilled_run_id columns are dropped (no longer tracked).

CREATE TABLE IF NOT EXISTS pending_reviews_new (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL,
  context_json      TEXT NOT NULL DEFAULT '{}',
  reminder_title    TEXT,
  enabled           INTEGER NOT NULL DEFAULT 1,        -- boolean 0/1
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Copy existing rows from the v2 table, mapping status → enabled.
-- (v2 always runs before v3, so pending_reviews exists. On a fresh install it's
-- empty and this copies zero rows.)
INSERT INTO pending_reviews_new (id, session_id, context_json, reminder_title, enabled, created_at, updated_at)
SELECT id, session_id, context_json, reminder_title,
       CASE WHEN status = 'pending' THEN 1 ELSE 0 END,
       created_at, updated_at
FROM pending_reviews;

-- Replace the old table.
DROP TABLE pending_reviews;
ALTER TABLE pending_reviews_new RENAME TO pending_reviews;

-- Lookups: by sessionId (the completion-time correlation key) and by enabled.
CREATE INDEX IF NOT EXISTS idx_pending_reviews_session_id ON pending_reviews(session_id);
CREATE INDEX IF NOT EXISTS idx_pending_reviews_enabled ON pending_reviews(enabled);
