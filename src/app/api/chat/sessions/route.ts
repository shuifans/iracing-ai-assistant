import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireActiveUser,
  validateOrigin,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { createSession, listSessions } from '@/modules/chat/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/chat/sessions — create a new empty session.
 */
export const POST = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const user = await requireAuth(request);
  requireActiveUser(user);
  validateOrigin(request);

  const session = createSession(user.id);
  return NextResponse.json(successResponse(session), { status: 201 });
});

/**
 * GET /api/chat/sessions — list sessions for the current user.
 */
export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const user = await requireAuth(request);
  requireActiveUser(user);

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 20), 1), 100);
  const cursor = url.searchParams.get('cursor') ?? undefined;

  const result = listSessions(user.id, limit, cursor);
  return NextResponse.json(
    successResponse({ sessions: result.sessions }, { nextCursor: result.nextCursor }),
  );
});
