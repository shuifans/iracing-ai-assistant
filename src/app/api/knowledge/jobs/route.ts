import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { listJobs } from '@/modules/knowledge/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const user = await requireAuth(request);
  requireRole(user, 'knowledge_admin', 'admin');
  requireActiveUser(user);

  const url = new URL(request.url);
  const status = url.searchParams.get('status') ?? undefined;
  const sourceId = url.searchParams.get('sourceId') ?? undefined;
  const limitParam = url.searchParams.get('limit');
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const limit = limitParam ? Math.min(Math.max(Number(limitParam), 1), 100) : undefined;

  const result = await listJobs({ status, sourceId, limit, cursor });

  return NextResponse.json(
    successResponse({ jobs: result.items }, { nextCursor: result.nextCursor }),
  );
});
