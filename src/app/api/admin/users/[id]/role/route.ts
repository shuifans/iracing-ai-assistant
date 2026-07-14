import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
  validateOrigin,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { changeUserRole } from '@/modules/users/service';
import { AppError } from '@/lib/errors';
import { USER_ROLES } from '@/config/constants';
import { recordAudit } from '@/modules/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const VALID_ROLES: readonly string[] = USER_ROLES;

export const PATCH = withErrorHandler(
  async (request: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    validateOrigin(request);
    const user = await requireAuth(request);
    requireRole(user, 'admin');
    requireActiveUser(user);

    const id = (await context!.params).id;
    const body = await request.json();
    const role = body.role;

    if (typeof role !== 'string' || !VALID_ROLES.includes(role)) {
      throw new AppError('VALIDATION_ERROR', `角色必须为以下值之一: ${VALID_ROLES.join(', ')}`, {
        role: `角色必须为以下值之一: ${VALID_ROLES.join(', ')}`,
      });
    }

    const updatedUser = await changeUserRole(id, role);

    try {
      recordAudit({
        actorId: user.id,
        action: 'user.role_changed',
        resource: 'user',
        resourceId: id,
        requestId: request.headers.get('x-request-id') ?? undefined,
        ipHash: request.headers.get('x-forwarded-for') ?? undefined,
        changes: { role },
      });
    } catch {
      /* audit failure must not break main flow */
    }

    return NextResponse.json(successResponse({ user: updatedUser }));
  },
);
