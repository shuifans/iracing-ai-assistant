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
import * as evalService from '@/modules/knowledge-evaluation/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// POST — trigger a manual re-clean carrying accumulated reviewer feedback.
// Requires an Idempotency-Key header (mirrors the approve route).
export const POST = withErrorHandler(
  async (request: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    validateOrigin(request);
    const user = await requireAuth(request);
    requireRole(user, 'knowledge_admin', 'admin');
    requireActiveUser(user);

    const draftId = context!.params.id;
    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (!idempotencyKey) {
      throw new AppError('VALIDATION_ERROR', 'Missing required header: Idempotency-Key');
    }

    const result = await evalService.reCleanWithFeedback(draftId, user.id);

    try {
      recordAudit({
        actorId: user.id,
        action: 'knowledge.reclean',
        resource: 'knowledge_draft',
        resourceId: draftId,
        requestId: request.headers.get('x-request-id') ?? undefined,
        ipHash: request.headers.get('x-forwarded-for') ?? undefined,
        changes: { jobId: result.jobId, kind: 're_clean', parentDraftId: draftId },
      });
    } catch {
      /* audit failure must not break main flow */
    }

    return NextResponse.json(successResponse(result));
  },
);
