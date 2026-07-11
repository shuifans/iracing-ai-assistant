import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
  validateOrigin,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { AppError } from '@/lib/errors';
import { submitFileSource } from '@/modules/knowledge/service';
import { ALLOWED_KNOWLEDGE_MIMES } from '@/modules/knowledge/schemas';
import { env } from '@/config/env';
import { recordAudit } from '@/modules/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/knowledge/sources/file — upload a knowledge source file.
 */
export const POST = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const user = await requireAuth(request);
  requireRole(user, 'knowledge_admin', 'admin');
  requireActiveUser(user);
  validateOrigin(request);

  // 1. Parse multipart form data
  const formData = await request.formData();
  const file = formData.get('file');

  // 2. Validate file presence
  if (!file || !(file instanceof Blob)) {
    throw new AppError('VALIDATION_ERROR', '未提供文件');
  }

  // 3. Validate MIME type
  if (
    !ALLOWED_KNOWLEDGE_MIMES.includes(
      file.type as (typeof ALLOWED_KNOWLEDGE_MIMES)[number],
    )
  ) {
    throw new AppError(
      'UNSUPPORTED_MEDIA_TYPE',
      `MIME type "${file.type}" is not allowed. Allow: ${ALLOWED_KNOWLEDGE_MIMES.join(', ')}`,
    );
  }

  // 4. Validate file size
  const maxBytes = env.UPLOAD_KNOWLEDGE_MAX_BYTES as number;
  if (file.size > maxBytes) {
    throw new AppError(
      'VALIDATION_ERROR',
      `文件大小不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB`,
    );
  }

  // 5. Read file buffer and submit
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await submitFileSource({
    file: buffer,
    originalName: file.name,
    mimeType: file.type,
    submittedBy: user.id,
  });

  try {
    recordAudit({
      actorId: user.id,
      action: 'knowledge.submitted',
      resource: 'knowledge_source',
      resourceId: result.sourceId,
      requestId: request.headers.get('x-request-id') ?? undefined,
      ipHash: request.headers.get('x-forwarded-for') ?? undefined,
      changes: { type: 'file', originalName: file.name },
    });
  } catch {
    /* audit failure must not break main flow */
  }

  // 6. Return 201
  return NextResponse.json(successResponse(result), { status: 201 });
});
