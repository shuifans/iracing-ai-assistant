/**
 * Audit service — convenience wrapper around repository.writeAuditLog.
 *
 * @module audit/service
 */

import { writeAuditLog } from './repository';
import type { AuditAction, AuditResource, AuditLogEntry } from './types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record an audit event. Delegates directly to repository.writeAuditLog.
 */
export function recordAudit(params: {
  actorId: string;
  action: AuditAction;
  resource: AuditResource;
  resourceId: string;
  requestId?: string;
  ipHash?: string;
  changes?: Record<string, any>;
}): AuditLogEntry {
  return writeAuditLog(params);
}
