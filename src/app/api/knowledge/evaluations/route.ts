import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, requireAuth, requireRole, requireActiveUser } from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import * as evalService from '@/modules/knowledge-evaluation/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — list evaluations (评估 tab). Query: tier, status, cursor, limit.
export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const user = await requireAuth(request);
  requireRole(user, 'knowledge_admin', 'admin');
  requireActiveUser(user);

  const url = new URL(request.url);
  const tier = url.searchParams.get('tier') ?? undefined;
  const status = url.searchParams.get('status') ?? undefined;
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.min(Math.max(Number(limitParam), 1), 100) : undefined;

  const result = evalService.listEvaluations({ tier, status, cursor, limit });

  return NextResponse.json(
    successResponse({ evaluations: result.items }, { nextCursor: result.nextCursor }),
  );
});
