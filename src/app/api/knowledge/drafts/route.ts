import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { listDrafts } from '@/modules/knowledge/service';
import { cursorPageSchema } from '@/modules/knowledge/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/knowledge/drafts — list cleaned drafts with cursor pagination.
 *
 * Query params: limit, cursor, status, sourceId, tier
 */
export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const user = await requireAuth(request);
  requireRole(user, 'knowledge_admin', 'admin');
  requireActiveUser(user);

  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit') ?? undefined;
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const status = url.searchParams.get('status') ?? undefined;
  const sourceId = url.searchParams.get('sourceId') ?? undefined;
  const tier = url.searchParams.get('tier') ?? undefined;

  const parsed = cursorPageSchema.parse({ limit: limitParam ?? 20, cursor });

  const result = await listDrafts({
    limit: parsed.limit,
    cursor: parsed.cursor,
    status,
    sourceId,
    tier,
  });

  return NextResponse.json(
    successResponse({ drafts: result.items }, { nextCursor: result.nextCursor }),
  );
});
