import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import {
  SESSION_STATUSES,
  MESSAGE_ROLES,
  MESSAGE_STATUSES,
  FEEDBACK_RATINGS,
} from '../../config/constants';
import { users } from './users';

// ─── chat_sessions ───────────────────────────────────────────────────────────

export const chatSessions = sqliteTable(
  'chat_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    qoderSessionId: text('qoder_session_id'),
    webSearchEnabled: integer('web_search_enabled', { mode: 'boolean' }).notNull().default(false),
    status: text('status', { enum: SESSION_STATUSES }).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    lastMessageAt: text('last_message_at').notNull(),
  },
  (table) => [index('idx_chat_sessions_user_last_msg').on(table.userId, table.lastMessageAt)],
);

export type ChatSession = typeof chatSessions.$inferSelect;
export type NewChatSession = typeof chatSessions.$inferInsert;

// ─── messages ────────────────────────────────────────────────────────────────

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    role: text('role', { enum: MESSAGE_ROLES }).notNull(),
    status: text('status', { enum: MESSAGE_STATUSES }).notNull(),
    content: text('content').notNull(),
    replyToMessageId: text('reply_to_message_id'),
    errorCode: text('error_code'),
    tokenInput: integer('token_input').notNull().default(0),
    tokenOutput: integer('token_output').notNull().default(0),
    costMicrousd: integer('cost_microusd').notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    createdAt: text('created_at').notNull(),
    completedAt: text('completed_at'),
  },
  (table) => [index('idx_messages_session_created').on(table.sessionId, table.createdAt)],
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

// ─── message_attachments ─────────────────────────────────────────────────────

export const messageAttachments = sqliteTable(
  'message_attachments',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('image'),
    relativePath: text('relative_path').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    width: integer('width'),
    height: integer('height'),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    boundAt: text('bound_at'),
  },
  (table) => [
    index('idx_message_attachments_message').on(table.messageId),
    index('idx_message_attachments_owner_unbound').on(table.uploadedBy, table.messageId),
    index('idx_message_attachments_expiry').on(table.expiresAt),
  ],
);

export type MessageAttachment = typeof messageAttachments.$inferSelect;
export type NewMessageAttachment = typeof messageAttachments.$inferInsert;

// ─── message_sources ─────────────────────────────────────────────────────────

export const messageSources = sqliteTable(
  'message_sources',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    sourceType: text('source_type', { enum: ['wiki', 'web'] as const }).notNull(),
    title: text('title').notNull(),
    url: text('url'),
    wikiPath: text('wiki_path'),
    excerpt: text('excerpt'),
    season: text('season'),
    retrievedAt: text('retrieved_at').notNull(),
  },
  (table) => [index('idx_message_sources_msg_ordinal').on(table.messageId, table.ordinal)],
);

export type MessageSource = typeof messageSources.$inferSelect;
export type NewMessageSource = typeof messageSources.$inferInsert;

// ─── message_feedback ────────────────────────────────────────────────────────

export const messageFeedback = sqliteTable(
  'message_feedback',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rating: text('rating', { enum: FEEDBACK_RATINGS }).notNull(),
    reason: text('reason'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_message_feedback_msg_user').on(table.messageId, table.userId)],
);

export type MessageFeedback = typeof messageFeedback.$inferSelect;
export type NewMessageFeedback = typeof messageFeedback.$inferInsert;
