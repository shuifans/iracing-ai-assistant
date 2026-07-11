/**
 * Audit module types — immutable event logging for admin actions.
 *
 * @module audit/types
 */

// ---------------------------------------------------------------------------
// Audit actions
// ---------------------------------------------------------------------------

export const AUDIT_ACTIONS = [
  // 用户管理
  'user.approved',
  'user.rejected',
  'user.disabled',
  'user.enabled',
  'user.deleted',
  'user.role_changed',
  // 会话
  'session.viewed',
  // 知识管理
  'knowledge.submitted',
  'knowledge.retried',
  'knowledge.edited',
  'knowledge.approved',
  'knowledge.rejected',
  'knowledge.archived',
  'knowledge.restored',
  'knowledge.git_retry',
  // 系统
  'rate_limit.updated',
  'settings.updated',
  'backup.restored',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// ---------------------------------------------------------------------------
// Audit resources
// ---------------------------------------------------------------------------

export type AuditResource =
  | 'user'
  | 'session'
  | 'knowledge_source'
  | 'knowledge_job'
  | 'knowledge_draft'
  | 'knowledge_item'
  | 'rate_limit_config'
  | 'system_setting';

// ---------------------------------------------------------------------------
// Audit log entry (returned from queries)
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  id: string;
  actorId: string;
  action: string;
  resource: string;
  resourceId: string;
  requestId: string | null;
  ipHash: string | null;
  changesJson: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Cursor page result
// ---------------------------------------------------------------------------

export interface CursorPageResult<T> {
  items: T[];
  nextCursor: string | null;
}
