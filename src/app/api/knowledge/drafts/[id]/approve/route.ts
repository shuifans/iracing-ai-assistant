import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
  validateOrigin,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { AppError } from '@/lib/errors';
import * as knowledgeService from '@/modules/knowledge/service';
import { recordAudit } from '@/modules/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST — 批准 draft（发布知识）
export const POST = withErrorHandler(
  async (request: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    validateOrigin(request);
    const user = await requireAuth(request);
    requireRole(user, 'knowledge_admin', 'admin');
    requireActiveUser(user);

    const id = (await context!.params).id;

    // Idempotency-Key header is required
    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (!idempotencyKey) {
      throw new AppError('VALIDATION_ERROR', 'Missing required header: Idempotency-Key');
    }

    const result = await knowledgeService.publishDraftReview(id, user.id, idempotencyKey);

    try {
      recordAudit({
        actorId: user.id,
        action: 'knowledge.approved',
        resource: 'knowledge_draft',
        resourceId: id,
        requestId: request.headers.get('x-request-id') ?? undefined,
        ipHash: request.headers.get('x-forwarded-for') ?? undefined,
      });
    } catch {
      /* audit failure must not break main flow */
    }

    return NextResponse.json(successResponse(result));
  },
);
