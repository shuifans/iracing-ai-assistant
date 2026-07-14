-- Migration: 20260713120000_C_evaluation
-- Description: Add knowledge evaluation + feedback tables, and re-clean/versioning columns on knowledge_jobs/knowledge_drafts

PRAGMA foreign_keys = ON;

-- ─── knowledge_evaluations ──────────────────────────────────────────────────
-- One row per draft evaluation. Re-clean produces a new draft → new evaluation.
CREATE TABLE IF NOT EXISTS knowledge_evaluations (
  id             TEXT PRIMARY KEY,
  draft_id       TEXT NOT NULL REFERENCES knowledge_drafts(id),
  target_type    TEXT NOT NULL DEFAULT 'draft' CHECK(target_type IN ('draft', 'item')),
  tier           TEXT NOT NULL DEFAULT 'pending' CHECK(tier IN ('A', 'B', 'C', 'D', 'pending')),
  overall_score  INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'heuristic_done', 'deep_running', 'complete', 'failed')),
  deep_eval      INTEGER NOT NULL DEFAULT 0,
  evaluated_by   TEXT REFERENCES users(id),
  error_message  TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_evaluations_draft_id ON knowledge_evaluations(draft_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_evaluations_tier ON knowledge_evaluations(tier);
CREATE INDEX IF NOT EXISTS idx_knowledge_evaluations_status ON knowledge_evaluations(status);

-- ─── evaluation_dimensions ───────────────────────────────────────────────────
-- Per-dimension scores for an evaluation. One row per (evaluation_id, dimension_key).
CREATE TABLE IF NOT EXISTS evaluation_dimensions (
  id             TEXT PRIMARY KEY,
  evaluation_id  TEXT NOT NULL REFERENCES knowledge_evaluations(id),
  dimension_key  TEXT NOT NULL,
  tier           TEXT NOT NULL CHECK(tier IN ('heuristic', 'probe', 'llm')),
  score          INTEGER NOT NULL,
  weight         INTEGER NOT NULL,
  rationale      TEXT,
  detail_json    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_evaluation_dimensions_eval_key ON evaluation_dimensions(evaluation_id, dimension_key);
CREATE INDEX IF NOT EXISTS idx_evaluation_dimensions_evaluation_id ON evaluation_dimensions(evaluation_id);

-- ─── evaluation_feedback ────────────────────────────────────────────────────
-- Admin feedback on a draft/evaluation. applied_to_job_id set when a re-clean job consumes it.
CREATE TABLE IF NOT EXISTS evaluation_feedback (
  id                                  TEXT PRIMARY KEY,
  draft_id                            TEXT NOT NULL REFERENCES knowledge_drafts(id),
  evaluation_id                       TEXT REFERENCES knowledge_evaluations(id),
  author_id                           TEXT NOT NULL REFERENCES users(id),
  dimension_ratings_json              TEXT,
  comments                            TEXT,
  improvement_instructions_json       TEXT,
  applied_to_job_id                   TEXT REFERENCES knowledge_jobs(id),
  created_at                          TEXT NOT NULL,
  updated_at                          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evaluation_feedback_draft_id ON evaluation_feedback(draft_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_feedback_evaluation_id ON evaluation_feedback(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_feedback_applied ON evaluation_feedback(applied_to_job_id);

-- ─── re-clean + versioning columns on knowledge_jobs ────────────────────────
ALTER TABLE knowledge_jobs ADD COLUMN instructions_json TEXT;
ALTER TABLE knowledge_jobs ADD COLUMN parent_draft_id TEXT REFERENCES knowledge_drafts(id);
ALTER TABLE knowledge_jobs ADD COLUMN job_kind TEXT NOT NULL DEFAULT 'clean' CHECK(job_kind IN ('clean', 're_clean'));

CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_kind ON knowledge_jobs(job_kind);
CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_parent_draft ON knowledge_jobs(parent_draft_id);

-- ─── versioning columns on knowledge_drafts ─────────────────────────────────
ALTER TABLE knowledge_drafts ADD COLUMN parent_draft_id TEXT REFERENCES knowledge_drafts(id);
ALTER TABLE knowledge_drafts ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_knowledge_drafts_parent_draft ON knowledge_drafts(parent_draft_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_drafts_version ON knowledge_drafts(version);
