import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, requireAuth, requireActiveUser, validateOrigin } from '@/modules/auth/middleware';
import { stopMessage } from '@/modules/chat/service';
import { successResponse } from '@/lib/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/chat/messages/:id/stop — stop generating a message.
 */
export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> => {
  const user = await requireAuth(request);
  requireActiveUser(user);
  validateOrigin(request);

  const { id } = await params;
  stopMessage(id, user.id);

  return NextResponse.json(successResponse({ stopped: true }));
});
