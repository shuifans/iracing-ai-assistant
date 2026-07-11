import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
  validateOrigin,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { AppError } from '@/lib/errors';
import * as knowledgeService from '@/modules/knowledge/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

const rejectDraftSchema = z.object({
  reason: z.string().min(1, '拒绝理由不能为空').max(500, '拒绝理由最多 500 字符'),
});

// POST — 拒绝 draft
export const POST = withErrorHandler(
  async (request: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    validateOrigin(request);
    const user = await requireAuth(request);
    requireRole(user, 'knowledge_admin', 'admin');
    requireActiveUser(user);

    const id = context!.params.id;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError('VALIDATION_ERROR', '无效的 JSON 请求体');
    }

    try {
      const { reason } = rejectDraftSchema.parse(body);
      await knowledgeService.rejectDraft(id, user.id, reason);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', err.issues.map((i) => i.message).join('; '));
      }
      throw err;
    }

    return NextResponse.json(successResponse({ ok: true }));
  },
);
