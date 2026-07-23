-- Fix knowledge_jobs.status CHECK constraint to include 'approved' and 'paused'
-- which were added to JOB_STATUSES in code but never migrated to the DB.

CREATE TABLE knowledge_jobs_new (
  id              TEXT PRIMARY KEY,
  source_id       TEXT NOT NULL,
  status          TEXT NOT NULL CHECK(status IN ('queued', 'paused', 'extracting', 'cleaning', 'pending_review', 'approved', 'publishing', 'published', 'rejected', 'failed', 'cancelled')),
  attempt         INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  available_at    TEXT NOT NULL,
  lease_owner     TEXT,
  lease_expires_at TEXT,
  heartbeat_at    TEXT,
  progress        INTEGER NOT NULL DEFAULT 0,
  error_code      TEXT,
  error_message   TEXT,
  started_at      TEXT,
  finished_at     TEXT,
  instructions_json TEXT,
  parent_draft_id TEXT REFERENCES knowledge_drafts(id),
  job_kind        TEXT NOT NULL DEFAULT 'clean' CHECK(job_kind IN ('clean', 're_clean')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES knowledge_sources(id)
);

INSERT INTO knowledge_jobs_new (
  id, source_id, status, attempt, max_attempts, available_at,
  lease_owner, lease_expires_at, heartbeat_at, progress,
  error_code, error_message, started_at, finished_at,
  instructions_json, parent_draft_id, job_kind, created_at, updated_at
)
SELECT
  id, source_id, status, attempt, max_attempts, available_at,
  lease_owner, lease_expires_at, heartbeat_at, progress,
  error_code, error_message, started_at, finished_at,
  instructions_json, parent_draft_id, job_kind, created_at, updated_at
FROM knowledge_jobs;

DROP TABLE knowledge_jobs;
ALTER TABLE knowledge_jobs_new RENAME TO knowledge_jobs;

CREATE INDEX idx_knowledge_jobs_status_available ON knowledge_jobs(status, available_at);
CREATE INDEX idx_knowledge_jobs_source_id ON knowledge_jobs(source_id);
CREATE INDEX idx_knowledge_jobs_kind ON knowledge_jobs(job_kind);
CREATE INDEX idx_knowledge_jobs_parent_draft ON knowledge_jobs(parent_draft_id);
