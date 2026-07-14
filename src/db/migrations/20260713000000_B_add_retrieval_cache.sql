-- Migration: 20260713000000_B_add_retrieval_cache
-- Description: Add retrieval_cache table for two-tier (LRU + SQLite) answer/retrieval caching

PRAGMA foreign_keys = ON;

-- ─── retrieval_cache ─────────────────────────────────────────────────────────
-- Keyed by sha256(normalize(query) + historyHash). L1 in-process LRU; L2 here.

CREATE TABLE IF NOT EXISTS retrieval_cache (
  cache_key    TEXT PRIMARY KEY,
  cache_type   TEXT NOT NULL CHECK(cache_type IN ('answer', 'retrieval')),
  query        TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  hit_count    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_retrieval_cache_type_expires ON retrieval_cache(cache_type, expires_at);
CREATE INDEX IF NOT EXISTS idx_retrieval_cache_created ON retrieval_cache(created_at);
