/**
 * Chat repository — DB CRUD for sessions, messages, attachments, sources, feedback.
 *
 * All functions are synchronous (better-sqlite3 is sync) but wrapped to match
 * the async interface used by the service layer.
 *
 * @module chat/repository
 */

import { eq, and, desc, sql, lt, like, gte, lte } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  chatSessions,
  messages,
  messageAttachments,
  messageSources,
  messageFeedback,
  type ChatSession,
  type Message,
  type MessageAttachment,
  type MessageSource,
} from '@/db/schema/chat';
import { generateId } from '@/lib/uuid';
import { utcNow } from '@/lib/datetime';
import { users } from '@/db/schema/users';
import type { AttachmentData, SourceData } from './types';

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

/**
 * Create a new chat session for a user.
 */
export function createSession(userId: string, title?: string): ChatSession {
  const db = getDb();
  const now = utcNow();
  const id = generateId();
  const newSession = {
    id,
    userId,
    title: title ?? '新会话',
    status: 'active' as const,
    qoderSessionId: null,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
  };

  db.insert(chatSessions).values(newSession).run();
  return newSession;
}

/**
 * Get a session by ID, verifying ownership.
 */
export function getSession(sessionId: string, userId: string): ChatSession | null {
  const db = getDb();
  const result = db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)))
    .limit(1)
    .all();
  return result[0] ?? null;
}

/**
 * List sessions for a user with cursor-based pagination.
 */
export function listSessions(
  userId: string,
  limit: number,
  cursor?: string,
): { sessions: ChatSession[]; nextCursor: string | null } {
  const db = getDb();

  const conditions = [eq(chatSessions.userId, userId)];
  if (cursor) {
    conditions.push(lt(chatSessions.lastMessageAt, cursor));
  }

  const rows = db
    .select()
    .from(chatSessions)
    .where(and(...conditions))
    .orderBy(desc(chatSessions.lastMessageAt))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const resultRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    sessions: resultRows,
    nextCursor: hasMore ? resultRows[resultRows.length - 1]!.lastMessageAt : null,
  };
}

// ---------------------------------------------------------------------------
// Admin queries
// ---------------------------------------------------------------------------

/**
 * Admin-enriched session row (includes username and messageCount).
 */
export interface AdminSessionRow extends ChatSession {
  username: string;
  messageCount: number;
}

/**
 * List all sessions (admin) with optional filters and cursor pagination.
 * Enriched with username and message count.
 */
export function adminListSessions(opts: {
  userId?: string;
  keyword?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  cursor?: string;
}): { sessions: AdminSessionRow[]; nextCursor: string | null } {
  const db = getDb();
  const limit = opts.limit ?? 20;

  const messageCountSubquery = db
    .select({
      sessionId: messages.sessionId,
      count: sql<number>`count(*)`.as('msg_count'),
    })
    .from(messages)
    .groupBy(messages.sessionId)
    .as('msg_counts');

  const conditions = [];
  if (opts.userId) {
    conditions.push(eq(chatSessions.userId, opts.userId));
  }
  if (opts.keyword) {
    conditions.push(like(chatSessions.title, `%${opts.keyword}%`));
  }
  if (opts.fromDate) {
    conditions.push(gte(chatSessions.lastMessageAt, opts.fromDate));
  }
  if (opts.toDate) {
    conditions.push(lte(chatSessions.lastMessageAt, opts.toDate));
  }
  if (opts.cursor) {
    conditions.push(lt(chatSessions.lastMessageAt, opts.cursor));
  }

  const rows = db
    .select({
      id: chatSessions.id,
      userId: chatSessions.userId,
      title: chatSessions.title,
      qoderSessionId: chatSessions.qoderSessionId,
      status: chatSessions.status,
      createdAt: chatSessions.createdAt,
      updatedAt: chatSessions.updatedAt,
      lastMessageAt: chatSessions.lastMessageAt,
      username: users.username,
      messageCount: sql<number>`coalesce(${messageCountSubquery.count}, 0)`.as('message_count'),
    })
    .from(chatSessions)
    .leftJoin(users, eq(chatSessions.userId, users.id))
    .leftJoin(
      messageCountSubquery,
      eq(chatSessions.id, messageCountSubquery.sessionId),
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(chatSessions.lastMessageAt))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const resultRows = hasMore ? rows.slice(0, limit) : rows;

  const sessions: AdminSessionRow[] = resultRows.map((row) => ({
    id: row.id,
    userId: row.userId,
    title: row.title,
    qoderSessionId: row.qoderSessionId,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastMessageAt: row.lastMessageAt,
    username: row.username ?? '未知用户',
    messageCount: row.messageCount ?? 0,
  }));

  return {
    sessions,
    nextCursor: hasMore ? sessions[sessions.length - 1]!.lastMessageAt : null,
  };
}

/**
 * Get a session by ID without ownership check (admin only).
 */
export function getSessionById(sessionId: string): ChatSession | null {
  const db = getDb();
  const result = db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionId))
    .limit(1)
    .all();
  return result[0] ?? null;
}

/**
 * Update session title.
 */
export function updateSessionTitle(sessionId: string, title: string): void {
  const db = getDb();
  const now = utcNow();
  db.update(chatSessions)
    .set({ title, updatedAt: now })
    .where(eq(chatSessions.id, sessionId))
    .run();
}

/**
 * Delete a session (cascade handled by FK).
 */
export function deleteSession(sessionId: string, userId: string): void {
  const db = getDb();
  db.delete(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)))
    .run();
}

/**
 * Update the qoder_session_id for a session.
 */
export function updateQoderSessionId(sessionId: string, qoderSessionId: string): void {
  const db = getDb();
  const now = utcNow();
  db.update(chatSessions)
    .set({ qoderSessionId, updatedAt: now })
    .where(eq(chatSessions.id, sessionId))
    .run();
}

/**
 * Update lastMessageAt for a session.
 */
export function updateSessionLastMessageAt(sessionId: string): void {
  const db = getDb();
  const now = utcNow();
  db.update(chatSessions)
    .set({ lastMessageAt: now, updatedAt: now })
    .where(eq(chatSessions.id, sessionId))
    .run();
}

// ---------------------------------------------------------------------------
// Message CRUD
// ---------------------------------------------------------------------------

/**
 * Create a new message in a session.
 */
export function createMessage(
  sessionId: string,
  role: string,
  content?: string,
  status?: string,
  replyToMessageId?: string,
): Message {
  const db = getDb();
  const now = utcNow();
  const id = generateId();
  const newMessage = {
    id,
    sessionId,
    role: role as 'user' | 'assistant' | 'system',
    status: (status ?? 'pending') as
      'pending' | 'streaming' | 'complete' | 'interrupted' | 'failed',
    content: content ?? '',
    replyToMessageId: replyToMessageId ?? null,
    createdAt: now,
  };

  db.insert(messages).values(newMessage).run();

  // Update session's lastMessageAt
  updateSessionLastMessageAt(sessionId);

  return {
    ...newMessage,
    errorCode: null,
    tokenInput: 0,
    tokenOutput: 0,
    costMicrousd: 0,
    durationMs: 0,
    completedAt: null,
  };
}

/**
 * Update a message with partial data.
 */
export function updateMessage(
  id: string,
  updates: Partial<
    Pick<
      Message,
      | 'content'
      | 'status'
      | 'errorCode'
      | 'tokenInput'
      | 'tokenOutput'
      | 'costMicrousd'
      | 'durationMs'
      | 'completedAt'
    >
  >,
): void {
  const db = getDb();
  db.update(messages).set(updates).where(eq(messages.id, id)).run();
}

/**
 * Get all messages for a session, ordered by creation time.
 */
export function getMessagesBySession(sessionId: string): Message[] {
  const db = getDb();
  return db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt)
    .all();
}

/**
 * Get a single message by ID.
 */
export function getMessage(id: string): Message | null {
  const db = getDb();
  const result = db.select().from(messages).where(eq(messages.id, id)).limit(1).all();
  return result[0] ?? null;
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/**
 * Create an attachment for a message.
 */
export function createAttachment(messageId: string, data: AttachmentData): MessageAttachment {
  const db = getDb();
  const now = utcNow();
  const id = generateId();
  const newAttachment = {
    id,
    messageId,
    kind: data.kind,
    relativePath: data.relativePath,
    mimeType: data.mimeType,
    sizeBytes: data.sizeBytes,
    sha256: data.sha256,
    width: data.width ?? null,
    height: data.height ?? null,
    createdAt: now,
  };

  db.insert(messageAttachments).values(newAttachment).run();
  return newAttachment;
}

/**
 * Get an attachment by ID.
 */
export function getAttachment(id: string): MessageAttachment | null {
  const db = getDb();
  const result = db
    .select()
    .from(messageAttachments)
    .where(eq(messageAttachments.id, id))
    .limit(1)
    .all();
  return result[0] ?? null;
}

/**
 * Get attachments for a message.
 */
export function getAttachmentsByMessage(messageId: string): MessageAttachment[] {
  const db = getDb();
  return db
    .select()
    .from(messageAttachments)
    .where(eq(messageAttachments.messageId, messageId))
    .all();
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/**
 * Create a source citation for a message.
 */
export function createMessageSource(
  messageId: string,
  ordinal: number,
  source: SourceData,
): MessageSource {
  const db = getDb();
  const id = generateId();
  const newSource = {
    id,
    messageId,
    ordinal,
    sourceType: source.sourceType,
    title: source.title,
    url: source.url ?? null,
    wikiPath: source.wikiPath ?? null,
    excerpt: source.excerpt ?? null,
    season: source.season ?? null,
    retrievedAt: source.retrievedAt,
  };

  db.insert(messageSources).values(newSource).run();
  return newSource;
}

/**
 * Get sources for a message.
 */
export function getSourcesByMessage(messageId: string): MessageSource[] {
  const db = getDb();
  return db
    .select()
    .from(messageSources)
    .where(eq(messageSources.messageId, messageId))
    .orderBy(messageSources.ordinal)
    .all();
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

/**
 * Create or update feedback for a message.
 */
export function upsertFeedback(
  messageId: string,
  userId: string,
  rating: string,
  reason?: string,
): void {
  const db = getDb();
  const now = utcNow();

  // Check if feedback exists
  const existing = db
    .select()
    .from(messageFeedback)
    .where(and(eq(messageFeedback.messageId, messageId), eq(messageFeedback.userId, userId)))
    .limit(1)
    .all();

  if (existing.length > 0) {
    db.update(messageFeedback)
      .set({ rating: rating as 'up' | 'down', reason: reason ?? null, updatedAt: now })
      .where(eq(messageFeedback.id, existing[0]!.id))
      .run();
  } else {
    const id = generateId();
    db.insert(messageFeedback)
      .values({
        id,
        messageId,
        userId,
        rating: rating as 'up' | 'down',
        reason: reason ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

/**
 * Delete feedback for a message.
 */
export function deleteFeedback(messageId: string, userId: string): void {
  const db = getDb();
  db.delete(messageFeedback)
    .where(and(eq(messageFeedback.messageId, messageId), eq(messageFeedback.userId, userId)))
    .run();
}

/**
 * Get feedback for a message by user.
 */
export function getFeedback(
  messageId: string,
  userId: string,
): { rating: string; reason?: string | null } | null {
  const db = getDb();
  const result = db
    .select()
    .from(messageFeedback)
    .where(and(eq(messageFeedback.messageId, messageId), eq(messageFeedback.userId, userId)))
    .limit(1)
    .all();
  return result[0] ? { rating: result[0].rating, reason: result[0].reason } : null;
}
