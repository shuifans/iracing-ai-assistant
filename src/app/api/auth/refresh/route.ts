import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { withErrorHandler, validateOrigin } from '@/modules/auth/middleware';
import { rotateRefreshToken, hashToken, createAccessToken } from '@/modules/auth/token-service';
import { setRefreshCookie } from '@/modules/auth/cookies';
import { getRefreshCookie } from '@/modules/auth/cookies';
import { successResponse } from '@/lib/response';
import { AppError } from '@/lib/errors';
import { getDb } from '@/db/client';
import { users, refreshTokens } from '@/db/schema/users';
import type { AuthenticatedUser } from '@/modules/auth/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandler(async (request: NextRequest) => {
  validateOrigin(request);

  const rawToken = getRefreshCookie(request);
  if (!rawToken) {
    throw AppError.fromCode('UNAUTHENTICATED', '未提供 Refresh Token');
  }

  const { token: newRawToken } = await rotateRefreshToken(rawToken);

  // Look up user info from the new refresh token record
  const db = getDb();
  const newTokenHash = hashToken(newRawToken);
  const [tokenRecord] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, newTokenHash))
    .limit(1);

  if (!tokenRecord) {
    throw AppError.fromCode('UNAUTHENTICATED', 'Token 记录不存在');
  }

  const [dbUser] = await db.select().from(users).where(eq(users.id, tokenRecord.userId)).limit(1);

  if (!dbUser) {
    throw AppError.fromCode('UNAUTHENTICATED', '用户不存在');
  }

  // Honour the account status: a disabled/pending user must not be able to
  // keep minting access tokens via refresh. (AuthenticatedUser.status is typed
  // as the literal 'active' by design — so verify first, then construct.)
  if (dbUser.status !== 'active') {
    throw AppError.fromCode('ACCOUNT_DISABLED', '账户已被禁用，无法刷新令牌');
  }

  const user: AuthenticatedUser = {
    id: dbUser.id,
    username: dbUser.username,
    role: dbUser.role as AuthenticatedUser['role'],
    status: 'active',
  };

  const accessToken = await createAccessToken(user);

  const response = NextResponse.json(successResponse({ accessToken }), { status: 200 });

  setRefreshCookie(response, newRawToken);
  return response;
});
