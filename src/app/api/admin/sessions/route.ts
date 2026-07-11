import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { adminListSessions } from '@/modules/chat/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/sessions — list all sessions (admin only).
 *
 * Filters: userId, keyword (title search), fromDate, toDate
 * Sorted by last_message_at DESC, cursor-paginated.
 */
export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const user = await requireAuth(request);
  requireRole(user, 'admin');
  requireActiveUser(user);

  const url = new URL(request.url);
  const userId = url.searchParams.get('userId') ?? undefined;
  const keyword = url.searchParams.get('keyword') ?? undefined;
  const fromDate = url.searchParams.get('fromDate') ?? undefined;
  const toDate = url.searchParams.get('toDate') ?? undefined;
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.min(Math.max(Number(limitParam), 1), 100) : undefined;

  const result = adminListSessions({ userId, keyword, fromDate, toDate, limit, cursor });

  return NextResponse.json(
    successResponse({ sessions: result.sessions }, { nextCursor: result.nextCursor }),
  );
});
