import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { withErrorHandler, requireAuth, validateOrigin } from '@/modules/auth/middleware';
import { hashToken, revokeTokenFamily } from '@/modules/auth/token-service';
import { getRefreshCookie, clearRefreshCookie } from '@/modules/auth/cookies';
import { successResponse } from '@/lib/response';
import { AppError } from '@/lib/errors';
import { getDb } from '@/db/client';
import { refreshTokens } from '@/db/schema/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandler(async (request: NextRequest) => {
  validateOrigin(request);
  await requireAuth(request);

  const rawToken = getRefreshCookie(request);
  if (rawToken) {
    const tokenHash = hashToken(rawToken);
    const db = getDb();
    const [tokenRecord] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    if (tokenRecord) {
      await revokeTokenFamily(tokenRecord.familyId);
    }
  }

  const response = NextResponse.json(
    successResponse({ message: '已退出登录' }),
    { status: 200 },
  );

  clearRefreshCookie(response);
  return response;
});
