import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { getPopularQuestions } from '@/modules/analytics/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const user = await requireAuth(request);
  requireRole(user, 'admin');
  requireActiveUser(user);

  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.min(Math.max(Number(limitParam), 1), 50) : undefined;

  const data = getPopularQuestions(limit);

  return NextResponse.json(successResponse(data));
});
