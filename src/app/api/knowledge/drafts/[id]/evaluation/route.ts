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
import { runEvaluationSchema } from '@/modules/knowledge-evaluation/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// GET — fetch the draft's evaluation + dimensions (for the review-page scorecard)
export const GET = withErrorHandler(
  async (request: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    const user = await requireAuth(request);
    requireRole(user, 'knowledge_admin', 'admin');
    requireActiveUser(user);

    const draftId = context!.params.id;
    const evaluation = evalService.getEvaluation(draftId);
    return NextResponse.json(successResponse({ evaluation }));
  },
);

// POST — run/re-run heuristic + probe evaluation ({deep:true} → Phase 2 LLM judge)
export const POST = withErrorHandler(
  async (request: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    validateOrigin(request);
    const user = await requireAuth(request);
    requireRole(user, 'knowledge_admin', 'admin');
    requireActiveUser(user);

    const draftId = context!.params.id;
    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      // empty body is valid (defaults to non-deep)
    }
    const parsed = runEvaluationSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const deep = parsed.data?.deep ?? false;

    const result = await evalService.evaluateDraft(draftId, { deep, evaluatedBy: user.id });

    try {
      recordAudit({
        actorId: user.id,
        action: 'knowledge.eval.run',
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
