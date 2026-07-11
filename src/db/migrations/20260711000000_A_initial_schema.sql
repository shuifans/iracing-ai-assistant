-- Migration: 20260711000000_A_initial_schema
-- Description: Initial database schema with all 16 tables, indexes and constraints

PRAGMA foreign_keys = ON;

-- ─── users ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  username        TEXT NOT NULL COLLATE NOCASE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK(role IN ('user', 'knowledge_admin', 'admin')),
  status          TEXT NOT NULL CHECK(status IN ('pending', 'active', 'rejected', 'disabled')),
  registration_reason TEXT,
  rejection_reason    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  approved_at     TEXT,
  last_login_at   TEXT,
  approved_by     TEXT,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- ─── refresh_tokens ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  token_hash      TEXT NOT NULL,
  family_id       TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  revoked_at      TEXT,
  replaced_by     TEXT,
  user_agent      TEXT,
  ip_hash         TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id ON refresh_tokens(family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- ─── chat_sessions ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  title           TEXT NOT NULL,
  qoder_session_id TEXT,
  status          TEXT NOT NULL CHECK(status IN ('active', 'archived')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  last_message_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_last_msg ON chat_sessions(user_id, last_message_at);

-- ─── messages ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL,
  role                TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  status              TEXT NOT NULL CHECK(status IN ('pending', 'streaming', 'complete', 'interrupted', 'failed')),
  content             TEXT NOT NULL,
  reply_to_message_id TEXT,
  error_code          TEXT,
  token_input         INTEGER NOT NULL DEFAULT 0,
  token_output        INTEGER NOT NULL DEFAULT 0,
  cost_microusd       INTEGER NOT NULL DEFAULT 0,
  duration_ms         INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  completed_at        TEXT,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at);

-- ─── message_attachments ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS message_attachments (
  id              TEXT PRIMARY KEY,
  message_id      TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'image',
  relative_path   TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  sha256          TEXT NOT NULL,
  width           INTEGER,
  height          INTEGER,
  created_at      TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- ─── message_sources ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS message_sources (
  id              TEXT PRIMARY KEY,
  message_id      TEXT NOT NULL,
  ordinal         INTEGER NOT NULL,
  source_type     TEXT NOT NULL CHECK(source_type IN ('wiki', 'web')),
  title           TEXT NOT NULL,
  url             TEXT,
  wiki_path       TEXT,
  excerpt         TEXT,
  season          TEXT,
  retrieved_at    TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_message_sources_msg_ordinal ON message_sources(message_id, ordinal);

-- ─── message_feedback ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS message_feedback (
  id              TEXT PRIMARY KEY,
  message_id      TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  rating          TEXT NOT NULL CHECK(rating IN ('up', 'down')),
  reason          TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_feedback_msg_user ON message_feedback(message_id, user_id);

-- ─── knowledge_sources ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id              TEXT PRIMARY KEY,
  input_type      TEXT NOT NULL CHECK(input_type IN ('file', 'url')),
  original_name   TEXT,
  mime_type       TEXT,
  relative_path   TEXT,
  source_url      TEXT,
  sha256          TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  status          TEXT NOT NULL CHECK(status IN ('stored', 'queued', 'processing', 'ready', 'failed', 'archived')),
  submitted_by    TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (submitted_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_sources_sha256 ON knowledge_sources(sha256);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_status ON knowledge_sources(status);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_submitted_by ON knowledge_sources(submitted_by);

-- ─── knowledge_jobs ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_jobs (
  id              TEXT PRIMARY KEY,
  source_id       TEXT NOT NULL,
  status          TEXT NOT NULL CHECK(status IN ('queued', 'extracting', 'cleaning', 'pending_review', 'publishing', 'published', 'rejected', 'failed', 'cancelled')),
  attempt         INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  available_at    TEXT NOT NULL,
  lease_owner     TEXT,
  lease_expires_at TEXT,
  heartbeat_at    TEXT,
  progress        INTEGER NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
  error_code      TEXT,
  error_message   TEXT,
  started_at      TEXT,
  finished_at     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES knowledge_sources(id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_status_available ON knowledge_jobs(status, available_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_source_id ON knowledge_jobs(source_id);

-- ─── knowledge_drafts ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_drafts (
  id                  TEXT PRIMARY KEY,
  job_id              TEXT NOT NULL,
  suggested_path      TEXT NOT NULL,
  title               TEXT NOT NULL,
  front_matter_json   TEXT NOT NULL,
  draft_relative_path TEXT NOT NULL,
  content_sha256      TEXT NOT NULL,
  status              TEXT NOT NULL CHECK(status IN ('pending_review', 'approved', 'rejected', 'superseded')),
  review_notes        TEXT,
  reviewed_by         TEXT,
  reviewed_at         TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES knowledge_jobs(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_drafts_job_id ON knowledge_drafts(job_id);

-- ─── knowledge_items ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_items (
  id              TEXT PRIMARY KEY,
  source_id       TEXT NOT NULL,
  draft_id        TEXT NOT NULL,
  title           TEXT NOT NULL,
  category        TEXT NOT NULL CHECK(category IN ('track-technique', 'car-setup', 'basics')),
  subcategory     TEXT NOT NULL,
  tags_json       TEXT NOT NULL,
  source_name     TEXT,
  source_url      TEXT,
  season          TEXT NOT NULL,
  wiki_path       TEXT NOT NULL,
  status          TEXT NOT NULL CHECK(status IN ('published', 'archived')),
  git_commit_sha  TEXT,
  wiki_sync_status TEXT NOT NULL CHECK(wiki_sync_status IN ('committed', 'push_pending', 'synced', 'push_failed')),
  published_by    TEXT NOT NULL,
  published_at    TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES knowledge_sources(id),
  FOREIGN KEY (draft_id) REFERENCES knowledge_drafts(id),
  FOREIGN KEY (published_by) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_items_wiki_path ON knowledge_items(wiki_path);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_category_sub ON knowledge_items(category, subcategory);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_source_id ON knowledge_items(source_id);

-- ─── usage_events ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS usage_events (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  session_id      TEXT,
  job_id          TEXT,
  event_type      TEXT NOT NULL,
  model           TEXT,
  token_input     INTEGER NOT NULL DEFAULT 0,
  token_output    INTEGER NOT NULL DEFAULT 0,
  cost_microusd   INTEGER NOT NULL DEFAULT 0,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  result          TEXT,
  knowledge_hit   TEXT,
  created_at      TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_usage_events_created_type ON usage_events(created_at, event_type);

-- ─── rate_limit_configs ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rate_limit_configs (
  id                TEXT PRIMARY KEY,
  scope             TEXT NOT NULL CHECK(scope IN ('global', 'role', 'user')),
  scope_key         TEXT NOT NULL,
  per_minute_limit  INTEGER,
  per_day_limit     INTEGER,
  max_session_turns INTEGER,
  enabled           INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limit_configs_scope_key ON rate_limit_configs(scope, scope_key);

-- ─── rate_limit_buckets ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  id              TEXT PRIMARY KEY,
  scope_key       TEXT NOT NULL,
  window_type     TEXT NOT NULL CHECK(window_type IN ('minute', 'day')),
  window_start    TEXT NOT NULL,
  count           INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limit_buckets_unique ON rate_limit_buckets(scope_key, window_type, window_start);

-- ─── audit_logs ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
  id              TEXT PRIMARY KEY,
  actor_id        TEXT NOT NULL,
  action          TEXT NOT NULL,
  resource        TEXT NOT NULL,
  resource_id     TEXT NOT NULL,
  request_id      TEXT,
  ip_hash         TEXT,
  changes_json    TEXT,
  created_at      TEXT NOT NULL,
  FOREIGN KEY (actor_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs(actor_id);

-- ─── system_settings ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_settings (
  id              TEXT PRIMARY KEY,
  key             TEXT NOT NULL,
  value           TEXT NOT NULL,
  description     TEXT,
  updated_at      TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(key);
