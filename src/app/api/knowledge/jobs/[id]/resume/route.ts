import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
  validateOrigin,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { resumePausedJob } from '@/modules/jobs/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandler(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<NextResponse> => {
    validateOrigin(request);
    const user = await requireAuth(request);
    requireRole(user, 'knowledge_admin', 'admin');
    requireActiveUser(user);

    const { id } = await params;
    const result = await resumePausedJob(id);

    return NextResponse.json(successResponse({ resumed: result.success }));
  },
);
