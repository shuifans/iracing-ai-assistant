/**
 * Audit repository — append-only write + cursor-paginated read for audit_logs.
 *
 * All functions are synchronous (better-sqlite3 is sync).
 *
 * @module audit/repository
 */

import { eq, and, desc, lt, gte, lte } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { auditLogs } from '@/db/schema/admin';
import { generateId } from '@/lib/uuid';
import { utcNow } from '@/lib/datetime';
import type { AuditAction, AuditResource, AuditLogEntry, CursorPageResult } from './types';

// ---------------------------------------------------------------------------
// Write (append-only)
// ---------------------------------------------------------------------------

/**
 * Write an immutable audit log entry.
 */
export function writeAuditLog(data: {
  actorId: string;
  action: AuditAction;
  resource: AuditResource;
  resourceId: string;
  requestId?: string;
  ipHash?: string;
  changes?: Record<string, any>;
}): AuditLogEntry {
  const db = getDb();
  const now = utcNow();
  const id = generateId();
  const row = {
    id,
    actorId: data.actorId,
    action: data.action,
    resource: data.resource,
    resourceId: data.resourceId,
    requestId: data.requestId ?? null,
    ipHash: data.ipHash ?? null,
    changesJson: data.changes ? JSON.stringify(data.changes) : null,
    createdAt: now,
  };

  db.insert(auditLogs).values(row).run();
  return row;
}

// ---------------------------------------------------------------------------
// Read (cursor pagination + filters)
// ---------------------------------------------------------------------------

/**
 * List audit logs with cursor-based pagination and optional filters.
 */
export function listAuditLogs(params: {
  limit?: number;
  cursor?: string;
  actorId?: string;
  action?: string;
  resource?: string;
  resourceId?: string;
  fromDate?: string;
  toDate?: string;
}): CursorPageResult<AuditLogEntry> {
  const db = getDb();
  const limit = params.limit ?? 50;

  const conditions = [];

  // Cursor: fetch rows older than the cursor timestamp
  if (params.cursor) {
    conditions.push(lt(auditLogs.createdAt, params.cursor));
  }

  // Filters
  if (params.actorId) {
    conditions.push(eq(auditLogs.actorId, params.actorId));
  }
  if (params.action) {
    conditions.push(eq(auditLogs.action, params.action));
  }
  if (params.resource) {
    conditions.push(eq(auditLogs.resource, params.resource));
  }
  if (params.resourceId) {
    conditions.push(eq(auditLogs.resourceId, params.resourceId));
  }
  if (params.fromDate) {
    conditions.push(gte(auditLogs.createdAt, params.fromDate));
  }
  if (params.toDate) {
    conditions.push(lte(auditLogs.createdAt, params.toDate));
  }

  const query = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = db
    .select()
    .from(auditLogs)
    .where(query)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const resultRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: resultRows as AuditLogEntry[],
    nextCursor: hasMore ? resultRows[resultRows.length - 1]!.createdAt : null,
  };
}
