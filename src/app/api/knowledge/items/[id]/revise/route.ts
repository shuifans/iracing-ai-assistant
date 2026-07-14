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
import { recordAudit } from '@/modules/audit/service';
import * as knowledgeService from '@/modules/knowledge/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// POST — derive a revision draft from a published knowledge item.
//
// Copies the item's published content into a new pending_review draft (version =
// parent + 1) backed by a review-only job that skips cleaning. The admin then
// reviews / edits / re-cleans the draft; approving it overwrites the existing
// item in place via the publisher's overwrite branch. Requires an
// Idempotency-Key header (mirrors the approve / re-clean routes).
export const POST = withErrorHandler(
  async (request: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    validateOrigin(request);
    const user = await requireAuth(request);
    requireRole(user, 'knowledge_admin', 'admin');
    requireActiveUser(user);

    const itemId = context!.params.id;

    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (!idempotencyKey) {
      throw new AppError('VALIDATION_ERROR', 'Missing required header: Idempotency-Key');
    }

    const result = await knowledgeService.reviseItem(itemId, user.id);

    try {
      recordAudit({
        actorId: user.id,
        action: 'knowledge.revise',
        resource: 'knowledge_item',
        resourceId: itemId,
        requestId: request.headers.get('x-request-id') ?? undefined,
        ipHash: request.headers.get('x-forwarded-for') ?? undefined,
        changes: {
          draftId: result.draftId,
          jobId: result.jobId,
          version: result.version,
          parentDraftId: itemId,
        },
      });
    } catch {
      /* audit failure must not break main flow */
    }

    return NextResponse.json(successResponse(result));
  },
);
