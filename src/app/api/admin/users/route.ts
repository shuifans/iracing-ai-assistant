import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { listUsers } from '@/modules/users/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const user = await requireAuth(request);
  requireRole(user, 'admin');
  requireActiveUser(user);

  const url = new URL(request.url);
  const status = url.searchParams.get('status') ?? undefined;
  const role = url.searchParams.get('role') ?? undefined;
  const search = url.searchParams.get('search') ?? undefined;
  const limitParam = url.searchParams.get('limit');
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const limit = limitParam ? Math.min(Math.max(Number(limitParam), 1), 100) : undefined;

  const result = await listUsers({ status, role, search, limit, cursor });

  return NextResponse.json(
    successResponse({ users: result.users }, { nextCursor: result.nextCursor }),
  );
});
