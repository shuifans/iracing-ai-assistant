import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, requireAuth, requireRole, requireActiveUser } from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import * as evalService from '@/modules/knowledge-evaluation/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// GET — version history for a draft (all drafts for the same source, newest first)
export const GET = withErrorHandler(
  async (request: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    const user = await requireAuth(request);
    requireRole(user, 'knowledge_admin', 'admin');
    requireActiveUser(user);

    const draftId = context!.params.id;
    const versions = evalService.getDraftVersions(draftId);
    return NextResponse.json(successResponse({ versions }));
  },
);
