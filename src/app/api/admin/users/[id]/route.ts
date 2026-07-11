import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, requireAuth, requireRole, requireActiveUser, validateOrigin } from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { deleteUser } from '@/modules/users/service';
import { AppError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

export const DELETE = withErrorHandler(
  async (request: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    validateOrigin(request);
    const user = await requireAuth(request);
    requireRole(user, 'admin');
    requireActiveUser(user);

    const id = context!.params.id;

    // Admin 不能删除自己
    if (id === user.id) {
      throw new AppError('FORBIDDEN', '管理员不能删除自己的账户');
    }

    await deleteUser(id);

    return NextResponse.json(successResponse({ deleted: true }));
  },
);
