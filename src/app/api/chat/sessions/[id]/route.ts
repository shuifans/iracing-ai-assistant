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
  updateSessionWebSearch,
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
 * PATCH /api/chat/sessions/:id — update exactly one supported session setting.
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError('VALIDATION_ERROR', '请求体必须是有效 JSON');
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new AppError('VALIDATION_ERROR', '请求体格式无效');
    }

    const values = body as Record<string, unknown>;
    const keys = Object.keys(values);
    if (keys.length !== 1 || !['title', 'webSearchEnabled'].includes(keys[0] ?? '')) {
      throw new AppError('VALIDATION_ERROR', '必须且只能更新一个支持的会话字段');
    }

    if (keys[0] === 'webSearchEnabled') {
      if (typeof values.webSearchEnabled !== 'boolean') {
        throw new AppError('VALIDATION_ERROR', '联网搜索开关必须为布尔值');
      }

      const updated = updateSessionWebSearch(id, user.id, values.webSearchEnabled);
      if (!updated) {
        throw new AppError('NOT_FOUND', '会话不存在或无权访问');
      }
      return NextResponse.json(
        successResponse({ id: updated.id, webSearchEnabled: updated.webSearchEnabled }),
      );
    }

    const title = values.title;
    const trimmedTitle = typeof title === 'string' ? title.trim() : '';
    if (typeof title !== 'string' || trimmedTitle.length === 0 || title.length > 200) {
      throw new AppError('VALIDATION_ERROR', '标题必须为 1-200 个字符');
    }

    updateSessionTitle(id, trimmedTitle);
    return NextResponse.json(successResponse({ id, title: trimmedTitle }));
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
