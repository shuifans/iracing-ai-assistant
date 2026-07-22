import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
  validateOrigin,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import * as knowledgeService from '@/modules/knowledge/service';
import { recordAudit } from '@/modules/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST — 将已通过但未发布的 draft 退回待审查
export const POST = withErrorHandler(
  async (request: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    validateOrigin(request);
    const user = await requireAuth(request);
    requireRole(user, 'knowledge_admin', 'admin');
    requireActiveUser(user);

    const id = (await context!.params).id;

    await knowledgeService.unapproveDraft(id, user.id);

    try {
      recordAudit({
        actorId: user.id,
        action: 'knowledge.unapproved',
        resource: 'knowledge_draft',
        resourceId: id,
        requestId: request.headers.get('x-request-id') ?? undefined,
        ipHash: request.headers.get('x-forwarded-for') ?? undefined,
      });
    } catch {
      /* audit failure must not break main flow */
    }

    return NextResponse.json(successResponse({ unapproved: true, draftId: id }));
  },
);
