-- Replace the legacy three-category constraint with the iRacing taxonomy.
-- Preserve rows during ordinary deployment. The explicit, confirmed
-- knowledge:reset command is solely responsible for deleting knowledge data.

CREATE TABLE knowledge_items_new (
  id               TEXT PRIMARY KEY,
  source_id        TEXT NOT NULL,
  draft_id         TEXT NOT NULL,
  title            TEXT NOT NULL,
  category         TEXT NOT NULL CHECK(category IN (
    'official-racing',
    'getting-started',
    'driving-technique',
    'car-setup',
    'cars-and-tracks',
    'hardware-and-software',
    -- Legacy values remain readable until the explicit reset is run.
    'track-technique',
    'basics'
  )),
  subcategory      TEXT NOT NULL,
  tags_json        TEXT NOT NULL,
  source_name      TEXT,
  source_url       TEXT,
  season           TEXT NOT NULL,
  wiki_path        TEXT NOT NULL,
  status           TEXT NOT NULL CHECK(status IN ('published', 'archived')),
  git_commit_sha   TEXT,
  wiki_sync_status TEXT NOT NULL CHECK(wiki_sync_status IN ('committed', 'push_pending', 'synced', 'push_failed')),
  published_by     TEXT NOT NULL,
  published_at     TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES knowledge_sources(id),
  FOREIGN KEY (draft_id) REFERENCES knowledge_drafts(id),
  FOREIGN KEY (published_by) REFERENCES users(id)
);

INSERT INTO knowledge_items_new (
  id, source_id, draft_id, title, category, subcategory, tags_json,
  source_name, source_url, season, wiki_path, status, git_commit_sha,
  wiki_sync_status, published_by, published_at, updated_at
)
SELECT
  id, source_id, draft_id, title, category, subcategory, tags_json,
  source_name, source_url, season, wiki_path, status, git_commit_sha,
  wiki_sync_status, published_by, published_at, updated_at
FROM knowledge_items;

DROP TABLE knowledge_items;
ALTER TABLE knowledge_items_new RENAME TO knowledge_items;

CREATE UNIQUE INDEX idx_knowledge_items_wiki_path ON knowledge_items(wiki_path);
CREATE INDEX idx_knowledge_items_category_sub ON knowledge_items(category, subcategory);
CREATE INDEX idx_knowledge_items_source_id ON knowledge_items(source_id);
