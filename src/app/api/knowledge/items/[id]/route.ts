import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
  validateOrigin,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { getItemWithContent, deleteArchivedItem } from '@/modules/knowledge/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/knowledge/items/:id — get knowledge item details with its published
 * content (front matter + body) so the backend can render the actual body.
 */
export const GET = withErrorHandler(
  async (request: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    const user = await requireAuth(request);
    requireRole(user, 'knowledge_admin', 'admin');
    requireActiveUser(user);

    const id = (await context!.params).id;
    const result = await getItemWithContent(id);

    return NextResponse.json(successResponse(result));
  },
);

/**
 * DELETE /api/knowledge/items/:id — permanently delete an archived item
 * (removes the wiki file, rebuilds the index, git commits, deletes the row).
 */
export const DELETE = withErrorHandler(
  async (request: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    validateOrigin(request);
    const user = await requireAuth(request);
    requireRole(user, 'knowledge_admin', 'admin');
    requireActiveUser(user);

    const id = (await context!.params).id;
    await deleteArchivedItem(id, user.id);

    return NextResponse.json(successResponse({ deleted: true, itemId: id }));
  },
);
