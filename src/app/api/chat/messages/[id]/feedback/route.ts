import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, requireAuth, requireActiveUser, validateOrigin } from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { upsertFeedback, deleteFeedback } from '@/modules/chat/repository';
import { AppError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PUT /api/chat/messages/:id/feedback — create or update feedback (like/dislike).
 */
export const PUT = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> => {
  const user = await requireAuth(request);
  requireActiveUser(user);
  validateOrigin(request);

  const { id } = await params;
  const body = await request.json();

  const rating = body.rating;
  if (rating !== 'up' && rating !== 'down') {
    throw new AppError('VALIDATION_ERROR', 'rating 必须为 "up" 或 "down"');
  }

  const reason = body.reason;
  if (reason !== undefined && typeof reason !== 'string') {
    throw new AppError('VALIDATION_ERROR', 'reason 必须为字符串');
  }

  upsertFeedback(id, user.id, rating, reason);
  return NextResponse.json(successResponse({ messageId: id, rating, reason }));
});

/**
 * DELETE /api/chat/messages/:id/feedback — remove feedback.
 */
export const DELETE = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> => {
  const user = await requireAuth(request);
  requireActiveUser(user);
  validateOrigin(request);

  const { id } = await params;
  deleteFeedback(id, user.id);

  return NextResponse.json(successResponse({ deleted: true }));
});
