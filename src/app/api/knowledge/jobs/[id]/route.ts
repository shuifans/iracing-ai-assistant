import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
  validateOrigin,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { getJobStatus, deleteJob } from '@/modules/knowledge/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandler(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<NextResponse> => {
    const user = await requireAuth(request);
    requireRole(user, 'knowledge_admin', 'admin');
    requireActiveUser(user);

    const { id } = await params;
    const job = await getJobStatus(id);

    return NextResponse.json(successResponse({ job }));
  },
);

// DELETE — 删除终态任务（含草稿/评估记录级联清理）
export const DELETE = withErrorHandler(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<NextResponse> => {
    validateOrigin(request);
    const user = await requireAuth(request);
    requireRole(user, 'knowledge_admin', 'admin');
    requireActiveUser(user);

    const { id } = await params;
    await deleteJob(id, user.id);

    return NextResponse.json(successResponse({ deleted: true, jobId: id }));
  },
);
