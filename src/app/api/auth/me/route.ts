import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { withErrorHandler, requireAuth } from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { AppError } from '@/lib/errors';
import { getDb } from '@/db/client';
import { users } from '@/db/schema/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const authUser = await requireAuth(request);

  // Fetch full user details from DB (JWT doesn't contain username)
  const db = getDb();
  const [dbUser] = await db
    .select()
    .from(users)
    .where(eq(users.id, authUser.id))
    .limit(1);

  if (!dbUser) {
    throw AppError.fromCode('NOT_FOUND', '用户不存在');
  }

  return NextResponse.json(
    successResponse({
      user: {
        id: dbUser.id,
        username: dbUser.username,
        role: dbUser.role,
        status: dbUser.status,
      },
    }),
    { status: 200 },
  );
});
