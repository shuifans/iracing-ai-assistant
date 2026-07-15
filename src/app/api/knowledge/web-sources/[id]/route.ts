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
import { webSourceUpdateSchema } from '@/modules/web-sources/schemas';
import { deleteWebSource, updateWebSource } from '@/modules/web-sources/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function authorize(request: NextRequest) {
  const user = await requireAuth(request);
  requireActiveUser(user);
  requireRole(user, 'knowledge_admin', 'admin');
  validateOrigin(request);
  return user;
}

export const PATCH = withErrorHandler(
  async (request: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    const user = await authorize(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError('VALIDATION_ERROR', '无效的 JSON 请求体');
    }
    try {
      const changes = webSourceUpdateSchema.parse(body);
      const source = updateWebSource((await context!.params).id, changes, user.id);
      return NextResponse.json(successResponse({ source }));
    } catch (error) {
      if (error instanceof ZodError) {
        throw new AppError(
          'VALIDATION_ERROR',
          error.issues.map((issue) => issue.message).join('; '),
        );
      }
      throw error;
    }
  },
);

export const DELETE = withErrorHandler(
  async (request: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    const user = await authorize(request);
    deleteWebSource((await context!.params).id, user.id);
    return NextResponse.json(successResponse({ deleted: true }));
  },
);
