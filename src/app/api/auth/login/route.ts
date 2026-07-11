import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { eq } from 'drizzle-orm';
import { withErrorHandler, validateOrigin } from '@/modules/auth/middleware';
import { loginSchema } from '@/modules/auth/schemas';
import { validateCredentials } from '@/modules/auth/service';
import { createAccessToken, createRefreshToken, hashIp } from '@/modules/auth/token-service';
import { setRefreshCookie } from '@/modules/auth/cookies';
import { successResponse } from '@/lib/response';
import { AppError } from '@/lib/errors';
import { utcNow } from '@/lib/datetime';
import { getDb } from '@/db/client';
import { users } from '@/db/schema/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandler(async (request: NextRequest) => {
  validateOrigin(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError('VALIDATION_ERROR', '无效的 JSON 请求体');
  }

  let username: string;
  let password: string;
  try {
    const parsed = loginSchema.parse(body);
    username = parsed.username;
    password = parsed.password;
  } catch (err) {
    if (err instanceof ZodError) {
      throw new AppError('VALIDATION_ERROR', err.issues.map((i) => i.message).join('; '));
    }
    throw err;
  }

  const user = await validateCredentials(username, password);

  // Update last_login_at
  const db = getDb();
  await db
    .update(users)
    .set({ lastLoginAt: utcNow() })
    .where(eq(users.id, user.id));

  const accessToken = await createAccessToken(user);

  const userAgent = request.headers.get('user-agent') ?? undefined;
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    undefined;
  const ipHash = ip ? hashIp(ip) : undefined;

  const { token: rawRefreshToken } = await createRefreshToken(
    user.id,
    undefined,
    userAgent,
    ipHash,
  );

  const response = NextResponse.json(
    successResponse({
      accessToken,
      user: { id: user.id, username: user.username, role: user.role },
    }),
    { status: 200 },
  );

  setRefreshCookie(response, rawRefreshToken);
  return response;
});
