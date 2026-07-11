import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { listItems } from '@/modules/knowledge/service';
import { cursorPageSchema } from '@/modules/knowledge/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/knowledge/items — list knowledge items with cursor pagination.
 *
 * Query params: limit, cursor, category, status
 */
export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const user = await requireAuth(request);
  requireRole(user, 'knowledge_admin', 'admin');
  requireActiveUser(user);

  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit') ?? undefined;
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const category = url.searchParams.get('category') ?? undefined;
  const status = url.searchParams.get('status') ?? undefined;

  const parsed = cursorPageSchema.parse({ limit: limitParam ?? 20, cursor });

  const result = await listItems({
    limit: parsed.limit,
    cursor: parsed.cursor,
    category,
    status,
  });

  return NextResponse.json(
    successResponse({ items: result.items }, { nextCursor: result.nextCursor }),
  );
});
