import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
  validateOrigin,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { AppError } from '@/lib/errors';
import { editDraftSchema } from '@/modules/knowledge/schemas';
import * as knowledgeService from '@/modules/knowledge/service';
import { recordAudit } from '@/modules/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET — 获取 draft 详情（含 diff: 原文 + 抽取文本 + 候选稿 + Front Matter）
export const GET = withErrorHandler(
  async (request: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    const user = await requireAuth(request);
    requireRole(user, 'knowledge_admin', 'admin');
    requireActiveUser(user);

    const id = (await context!.params).id;
    const result = await knowledgeService.getDraftWithDiff(id);

    return NextResponse.json(successResponse(result));
  },
);

// PATCH — 编辑 draft 内容
export const PATCH = withErrorHandler(
  async (request: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    validateOrigin(request);
    const user = await requireAuth(request);
    requireRole(user, 'knowledge_admin', 'admin');
    requireActiveUser(user);

    const id = (await context!.params).id;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError('VALIDATION_ERROR', '无效的 JSON 请求体');
    }

    try {
      const { content } = editDraftSchema.parse(body);
      await knowledgeService.editDraft(id, content, user.id);

      try {
        recordAudit({
          actorId: user.id,
          action: 'knowledge.edited',
          resource: 'knowledge_draft',
          resourceId: id,
          requestId: request.headers.get('x-request-id') ?? undefined,
          ipHash: request.headers.get('x-forwarded-for') ?? undefined,
        });
      } catch {
        /* audit failure must not break main flow */
      }

      return NextResponse.json(successResponse({ message: 'Draft updated successfully' }));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', err.issues.map((i) => i.message).join('; '));
      }
      throw err;
    }
  },
);
