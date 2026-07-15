import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const webKnowledgeSources = sqliteTable(
  'web_knowledge_sources',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    scopeType: text('scope_type', {
      enum: ['domain', 'path', 'exact_url'] as const,
    }).notNull(),
    url: text('url').notNull(),
    sourceLevel: text('source_level', {
      enum: ['official', 'community'] as const,
    }).notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    description: text('description'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_web_knowledge_sources_url_scope').on(table.url, table.scopeType),
    index('idx_web_knowledge_sources_enabled').on(table.enabled, table.sourceLevel),
  ],
);

export type WebKnowledgeSource = typeof webKnowledgeSources.$inferSelect;
export type NewWebKnowledgeSource = typeof webKnowledgeSources.$inferInsert;
