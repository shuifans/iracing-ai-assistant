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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/knowledge/git/retry — retry git sync for push_failed items.
 *
 * Resets sync status to push_pending so the publisher (D13) picks them up.
 */
export const POST = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  validateOrigin(request);
  const user = await requireAuth(request);
  requireRole(user, 'knowledge_admin', 'admin');
  requireActiveUser(user);

  const count = await retryGitSync();

  return NextResponse.json(successResponse({ retried: count }));
});
