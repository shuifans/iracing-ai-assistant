import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
  validateOrigin,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { retryGitSync } from '@/modules/knowledge/service';
import { recordAudit } from '@/modules/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/knowledge/git/retry — retry git sync for push_failed items.
 *
 * Executes the publisher retry path and reports how many failed items were attempted.
 */
export const POST = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  validateOrigin(request);
  const user = await requireAuth(request);
  requireRole(user, 'knowledge_admin', 'admin');
  requireActiveUser(user);

  const count = await retryGitSync();

  try {
    recordAudit({
      actorId: user.id,
      action: 'knowledge.git_retry',
      resource: 'knowledge_item',
      resourceId: 'batch',
      requestId: request.headers.get('x-request-id') ?? undefined,
      ipHash: request.headers.get('x-forwarded-for') ?? undefined,
      changes: { count },
    });
  } catch {
    /* audit failure must not break main flow */
  }

  return NextResponse.json(successResponse({ retried: count }));
});
