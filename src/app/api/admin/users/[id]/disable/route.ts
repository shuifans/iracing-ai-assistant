import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, requireAuth, requireRole, requireActiveUser, validateOrigin } from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { disableUser } from '@/modules/users/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

export const PATCH = withErrorHandler(
  async (request: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    validateOrigin(request);
    const user = await requireAuth(request);
    requireRole(user, 'admin');
    requireActiveUser(user);

    const id = context!.params.id;
    const disabledUser = await disableUser(id);

    return NextResponse.json(successResponse({ user: disabledUser }));
  },
);
