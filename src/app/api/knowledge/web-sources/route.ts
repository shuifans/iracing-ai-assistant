import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from '@/lib/errors';
import { successResponse } from '@/lib/response';
import {
  requireActiveUser,
  requireAuth,
  requireRole,
  validateOrigin,
  withErrorHandler,
} from '@/modules/auth/middleware';
import { webSourceInputSchema } from '@/modules/web-sources/schemas';
import { createWebSource, listWebSources } from '@/modules/web-sources/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function authorize(request: NextRequest, mutation = false) {
  const user = await requireAuth(request);
  requireActiveUser(user);
  requireRole(user, 'knowledge_admin', 'admin');
  if (mutation) validateOrigin(request);
  return user;
}

export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  await authorize(request);
  return NextResponse.json(successResponse({ sources: listWebSources() }));
});

export const POST = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const user = await authorize(request, true);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError('VALIDATION_ERROR', '无效的 JSON 请求体');
  }
  try {
    const source = createWebSource(webSourceInputSchema.parse(body), user.id);
    return NextResponse.json(successResponse({ source }), { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      throw new AppError(
        'VALIDATION_ERROR',
        error.issues.map((issue) => issue.message).join('; '),
      );
    }
    throw error;
  }
});
