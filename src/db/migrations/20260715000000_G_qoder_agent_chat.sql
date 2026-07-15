ALTER TABLE chat_sessions ADD COLUMN web_search_enabled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE web_knowledge_sources (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('domain', 'path', 'exact_url')),
  url TEXT NOT NULL,
  source_level TEXT NOT NULL CHECK (source_level IN ('official', 'community')),
  enabled INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_web_knowledge_sources_url_scope
  ON web_knowledge_sources(url, scope_type);
CREATE INDEX idx_web_knowledge_sources_enabled
  ON web_knowledge_sources(enabled, source_level);
