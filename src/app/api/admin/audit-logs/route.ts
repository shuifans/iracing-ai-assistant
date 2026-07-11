import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { listAuditLogs } from '@/modules/audit/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const user = await requireAuth(request);
  requireRole(user, 'admin');
  requireActiveUser(user);

  const url = new URL(request.url);
  const actorId = url.searchParams.get('actorId') ?? undefined;
  const action = url.searchParams.get('action') ?? undefined;
  const resource = url.searchParams.get('resource') ?? undefined;
  const resourceId = url.searchParams.get('resourceId') ?? undefined;
  const fromDate = url.searchParams.get('fromDate') ?? undefined;
  const toDate = url.searchParams.get('toDate') ?? undefined;
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.min(Math.max(Number(limitParam), 1), 100) : undefined;

  const result = listAuditLogs({ actorId, action, resource, resourceId, fromDate, toDate, cursor, limit });

  return NextResponse.json(
    successResponse({ auditLogs: result.items }, { nextCursor: result.nextCursor }),
  );
});
