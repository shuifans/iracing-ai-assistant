import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
  validateOrigin,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { rejectUser } from '@/modules/users/service';
import { AppError } from '@/lib/errors';
import { recordAudit } from '@/modules/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

export const POST = withErrorHandler(
  async (request: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    validateOrigin(request);
    const user = await requireAuth(request);
    requireRole(user, 'admin');
    requireActiveUser(user);

    const id = context!.params.id;
    const body = await request.json();
    const reason = body.reason;

    if (typeof reason !== 'string' || reason.length < 1 || reason.length > 500) {
      throw new AppError('VALIDATION_ERROR', '拒绝理由为必填项，长度需在 1-500 字符之间', {
        reason: '拒绝理由为必填项，长度需在 1-500 字符之间',
      });
    }

    const rejectedUser = await rejectUser(id, reason);

    try {
      recordAudit({
        actorId: user.id,
        action: 'user.rejected',
        resource: 'user',
        resourceId: id,
        requestId: request.headers.get('x-request-id') ?? undefined,
        ipHash: request.headers.get('x-forwarded-for') ?? undefined,
        changes: { reason },
      });
    } catch {
      /* audit failure must not break main flow */
    }

    return NextResponse.json(successResponse({ user: rejectedUser }));
  },
);
