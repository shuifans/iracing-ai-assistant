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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// POST — 批准 draft（发布知识）
export const POST = withErrorHandler(
  async (request: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    validateOrigin(request);
    const user = await requireAuth(request);
    requireRole(user, 'knowledge_admin', 'admin');
    requireActiveUser(user);

    const id = context!.params.id;

    // Idempotency-Key header is required
    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (!idempotencyKey) {
      throw new AppError('VALIDATION_ERROR', 'Missing required header: Idempotency-Key');
    }

    const result = await knowledgeService.approveDraft(id, user.id, idempotencyKey);

    return NextResponse.json(successResponse(result));
  },
);
