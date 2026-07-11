import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireActiveUser,
  validateOrigin,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import {
  getSession,
  getMessagesBySession,
  updateSessionTitle,
  deleteSession,
} from '@/modules/chat/repository';
import { AppError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/chat/sessions/:id — session detail with messages.
 */
export const GET = withErrorHandler(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<NextResponse> => {
    const user = await requireAuth(request);
    requireActiveUser(user);

    const { id } = await params;
    const session = getSession(id, user.id);
    if (!session) {
      throw new AppError('NOT_FOUND', '会话不存在或无权访问');
    }

    const messages = getMessagesBySession(id);
    return NextResponse.json(successResponse({ session, messages }));
  },
);

/**
 * PATCH /api/chat/sessions/:id — update session title.
 */
export const PATCH = withErrorHandler(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<NextResponse> => {
    const user = await requireAuth(request);
    requireActiveUser(user);
    validateOrigin(request);

    const { id } = await params;
    const session = getSession(id, user.id);
    if (!session) {
      throw new AppError('NOT_FOUND', '会话不存在或无权访问');
    }

    const body = await request.json();
    const title = body.title;
    if (typeof title !== 'string' || title.trim().length === 0 || title.length > 200) {
      throw new AppError('VALIDATION_ERROR', '标题必须为 1-200 个字符');
    }

    updateSessionTitle(id, title.trim());
    return NextResponse.json(successResponse({ id, title: title.trim() }));
  },
);

/**
 * DELETE /api/chat/sessions/:id — delete session and cascading data.
 */
export const DELETE = withErrorHandler(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<NextResponse> => {
    const user = await requireAuth(request);
    requireActiveUser(user);
    validateOrigin(request);

    const { id } = await params;
    const session = getSession(id, user.id);
    if (!session) {
      throw new AppError('NOT_FOUND', '会话不存在或无权访问');
    }

    deleteSession(id, user.id);
    return NextResponse.json(successResponse({ deleted: true }));
  },
);
