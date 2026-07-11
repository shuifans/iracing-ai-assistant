import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { getSessionById, getMessagesBySession } from '@/modules/chat/repository';
import { recordAudit } from '@/modules/audit/service';
import { AppError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/sessions/:id — session detail with messages (admin only).
 *
 * No ownership check — admin can view any user's session.
 * Writes an audit log entry on every access.
 */
export const GET = withErrorHandler(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<NextResponse> => {
    const user = await requireAuth(request);
    requireRole(user, 'admin');
    requireActiveUser(user);

    const { id } = await params;
    const session = getSessionById(id);
    if (!session) {
      throw new AppError('NOT_FOUND', '会话不存在');
    }

    const messages = getMessagesBySession(id);

    // Audit log — admin viewed this session
    recordAudit({
      actorId: user.id,
      action: 'session.viewed',
      resource: 'session',
      resourceId: id,
    });

    return NextResponse.json(successResponse({ session, messages }));
  },
);
