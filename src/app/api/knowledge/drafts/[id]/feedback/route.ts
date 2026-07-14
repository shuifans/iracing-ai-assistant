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
import { submitFeedbackSchema } from '@/modules/knowledge-evaluation/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET — list feedback for a draft
export const GET = withErrorHandler(
  async (request: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    const user = await requireAuth(request);
    requireRole(user, 'knowledge_admin', 'admin');
    requireActiveUser(user);

    const draftId = (await context!.params).id;
    const feedback = evalService.getFeedback(draftId);
    return NextResponse.json(successResponse({ feedback }));
  },
);

// POST — submit reviewer feedback (dimension ratings + comments + improvement instructions)
export const POST = withErrorHandler(
  async (request: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    validateOrigin(request);
    const user = await requireAuth(request);
    requireRole(user, 'knowledge_admin', 'admin');
    requireActiveUser(user);

    const draftId = (await context!.params).id;
    const body = await request.json();
    const parsed = submitFeedbackSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid feedback');
    }

    const result = await evalService.submitFeedback(draftId, parsed.data, user.id);

    try {
      recordAudit({
        actorId: user.id,
        action: 'knowledge.feedback',
        resource: 'knowledge_draft',
        resourceId: draftId,
        requestId: request.headers.get('x-request-id') ?? undefined,
        ipHash: request.headers.get('x-forwarded-for') ?? undefined,
      });
    } catch {
      /* audit failure must not break main flow */
    }

    return NextResponse.json(successResponse(result));
  },
);
