/**
 * Chat repository — DB CRUD for sessions, messages, attachments, sources, feedback.
 *
 * All functions are synchronous (better-sqlite3 is sync) but wrapped to match
 * the async interface used by the service layer.
 *
 * @module chat/repository
 */

import { eq, and, desc, sql, lt, like, gte, lte, inArray, isNull } from 'drizzle-orm';
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
import { AppError } from '@/lib/errors';
import { users } from '@/db/schema/users';
import type { AttachmentData, SourceData } from './types';
import { MAX_CHAT_ATTACHMENTS, MAX_CHAT_ATTACHMENT_TOTAL_BYTES } from './attachment-input';

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
    webSearchEnabled: false,
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
      webSearchEnabled: chatSessions.webSearchEnabled,
      status: chatSessions.status,
      createdAt: chatSessions.createdAt,
      updatedAt: chatSessions.updatedAt,
      lastMessageAt: chatSessions.lastMessageAt,
      username: users.username,
      messageCount: sql<number>`coalesce(${messageCountSubquery.count}, 0)`.as('message_count'),
    })
    .from(chatSessions)
    .leftJoin(users, eq(chatSessions.userId, users.id))
    .leftJoin(messageCountSubquery, eq(chatSessions.id, messageCountSubquery.sessionId))
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
    webSearchEnabled: row.webSearchEnabled,
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
 * Update whether a session may use web search, verifying ownership.
 */
export function updateSessionWebSearch(
  sessionId: string,
  userId: string,
  enabled: boolean,
): ChatSession | null {
  const db = getDb();
  db.update(chatSessions)
    .set({ webSearchEnabled: enabled, updatedAt: utcNow() })
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)))
    .run();
  return getSession(sessionId, userId);
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
export function updateQoderSessionId(sessionId: string, qoderSessionId: string | null): void {
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

/**
 * Get a message only when its parent session belongs to the given user.
 */
export function getMessageForUser(id: string, userId: string): Message | null {
  const db = getDb();
  const result = db
    .select({
      id: messages.id,
      sessionId: messages.sessionId,
      role: messages.role,
      status: messages.status,
      content: messages.content,
      replyToMessageId: messages.replyToMessageId,
      errorCode: messages.errorCode,
      tokenInput: messages.tokenInput,
      tokenOutput: messages.tokenOutput,
      costMicrousd: messages.costMicrousd,
      durationMs: messages.durationMs,
      createdAt: messages.createdAt,
      completedAt: messages.completedAt,
    })
    .from(messages)
    .innerJoin(chatSessions, eq(messages.sessionId, chatSessions.id))
    .where(and(eq(messages.id, id), eq(chatSessions.userId, userId)))
    .limit(1)
    .all();
  return result[0] ?? null;
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/**
 * Create an unbound attachment owned by the uploading user.
 */
export function createAttachment(uploadedBy: string, data: AttachmentData): MessageAttachment {
  const db = getDb();
  const now = utcNow();
  const expiresAt = new Date(new Date(now).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const id = generateId();
  const newAttachment = {
    id,
    messageId: null,
    uploadedBy,
    kind: data.kind,
    relativePath: data.relativePath,
    mimeType: data.mimeType,
    sizeBytes: data.sizeBytes,
    sha256: data.sha256,
    width: data.width ?? null,
    height: data.height ?? null,
    createdAt: now,
    expiresAt,
    boundAt: null,
  };

  db.insert(messageAttachments).values(newAttachment).run();
  return newAttachment;
}

/**
 * Create a user message and bind all supplied uploads in one SQLite
 * transaction. Conditional updates close the validation/update race even if
 * another sender attempts to bind the same attachment concurrently.
 */
export function createUserMessageWithAttachments(
  sessionId: string,
  userId: string,
  content: string,
  attachmentIds: string[],
): Message {
  const db = getDb();
  const uniqueIds = [...new Set(attachmentIds)];
  if (uniqueIds.length !== attachmentIds.length) {
    throw new AppError('VALIDATION_ERROR', '附件 ID 不能重复');
  }
  if (uniqueIds.length > MAX_CHAT_ATTACHMENTS) {
    throw new AppError('VALIDATION_ERROR', `每条消息最多允许 ${MAX_CHAT_ATTACHMENTS} 个附件`);
  }

  return db.transaction(() => {
    const attachments = uniqueIds.length
      ? db.select().from(messageAttachments).where(inArray(messageAttachments.id, uniqueIds)).all()
      : [];

    if (
      attachments.length !== uniqueIds.length ||
      attachments.some((a) => a.uploadedBy !== userId)
    ) {
      throw new AppError('NOT_FOUND', '附件不存在或无权使用');
    }
    if (attachments.some((a) => a.messageId !== null)) {
      throw new AppError('VALIDATION_ERROR', '附件已绑定到其他消息');
    }
    const totalBytes = attachments.reduce((sum, attachment) => sum + attachment.sizeBytes, 0);
    if (totalBytes > MAX_CHAT_ATTACHMENT_TOTAL_BYTES) {
      throw new AppError('VALIDATION_ERROR', '附件总大小不能超过 20MB');
    }
    const now = utcNow();
    if (attachments.some((a) => a.expiresAt <= now)) {
      throw new AppError('VALIDATION_ERROR', '附件已过期，请重新上传');
    }

    const message = createMessage(sessionId, 'user', content, 'complete');
    for (const attachment of attachments) {
      const result = db
        .update(messageAttachments)
        .set({ messageId: message.id, boundAt: now })
        .where(
          and(
            eq(messageAttachments.id, attachment.id),
            eq(messageAttachments.uploadedBy, userId),
            isNull(messageAttachments.messageId),
          ),
        )
        .run();
      if (result.changes !== 1) {
        throw new AppError('VALIDATION_ERROR', '附件已被使用，请重新上传');
      }
    }
    return message;
  });
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
