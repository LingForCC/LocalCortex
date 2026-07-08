-- Handoffs (pending reviews) — correlates an in-flight agent session with
-- free-form context that should be injected into an event-triggered rule's
-- prompt when that session completes.
--
-- See src/shared/schemas/handoff-schema.ts for the row shape + rationale
-- (Level-2 free-form `context`; LocalCortex is a dumb pipe with zero task-
-- manager domain knowledge).
--
-- `context_json` stores the opaque key-value map the user registered; it is
-- merged into the triggering event's payload at completion time so rules can
-- render `{{key}}` template variables.

CREATE TABLE IF NOT EXISTS pending_reviews (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL,                     -- opaque agent session id (sess_…)
  context_json      TEXT NOT NULL DEFAULT '{}',        -- JSON: Record<string,string>
  reminder_title    TEXT,                              -- optional informational label
  status            TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'fulfilled' | 'cancelled'
  rule_id           TEXT,                              -- rule that fulfilled it (informational)
  fulfilled_run_id  INTEGER,                           -- runs.id that fulfilled it (informational)
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Lookups: by sessionId (the completion-time correlation key) and by status.
CREATE INDEX IF NOT EXISTS idx_pending_reviews_session_id ON pending_reviews(session_id);
CREATE INDEX IF NOT EXISTS idx_pending_reviews_status ON pending_reviews(status);
