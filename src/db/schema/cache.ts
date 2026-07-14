import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// ─── retrieval_cache ─────────────────────────────────────────────────────────
// Two-tier cache backing store for chat answers and retrieval results.
// L1 is an in-process LRU (lru-cache); L2 is this SQLite table.
// Key = sha256(normalize(query) + historyHash) so multi-turn contexts differ.

export const retrievalCache = sqliteTable(
  'retrieval_cache',
  {
    cacheKey: text('cache_key').primaryKey(),
    cacheType: text('cache_type').notNull(), // 'answer' | 'retrieval'
    query: text('query').notNull(),
    payloadJson: text('payload_json').notNull(),
    expiresAt: text('expires_at').notNull(), // ISO-8601
    hitCount: integer('hit_count').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_retrieval_cache_type_expires').on(table.cacheType, table.expiresAt),
    index('idx_retrieval_cache_created').on(table.createdAt),
  ],
);

export type RetrievalCache = typeof retrievalCache.$inferSelect;
export type NewRetrievalCache = typeof retrievalCache.$inferInsert;
