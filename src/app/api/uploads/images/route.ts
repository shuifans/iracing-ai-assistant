import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireActiveUser,
  validateOrigin,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { createAttachment } from '@/modules/chat/repository';
import { generateId } from '@/lib/uuid';
import { AppError } from '@/lib/errors';
import { writeFile, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_FILE_SIZE,
  getImageDimensions,
  validateImageUpload,
  MIME_TO_EXT,
} from '@/lib/image-validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/uploads/images — create an owned, initially unbound chat image. */
export const POST = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const user = await requireAuth(request);
  requireActiveUser(user);
  validateOrigin(request);

  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || !(file instanceof Blob)) {
    throw new AppError('VALIDATION_ERROR', '未提供文件');
  }
  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
    throw new AppError('VALIDATION_ERROR', '仅支持 JPEG、PNG、WebP 格式');
  }
  if (file.size > MAX_IMAGE_FILE_SIZE) {
    throw new AppError('VALIDATION_ERROR', '文件大小不能超过 10MB');
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = validateImageUpload(buffer, file.type);
  if (validation) {
    throw new AppError('VALIDATION_ERROR', validation.error);
  }

  const dimensions = getImageDimensions(buffer, file.type);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const uuid = generateId();
  const ext = MIME_TO_EXT[file.type]!;
  const relativePath = `chat/${year}/${month}/${uuid}.${ext}`;
  const uploadRoot = join(process.env.DATA_ROOT ?? join(process.cwd(), 'data'), 'uploads');
  const absolutePath = join(uploadRoot, relativePath);

  await mkdir(join(uploadRoot, 'chat', year, month), { recursive: true });
  await writeFile(absolutePath, buffer);

  let attachment;
  try {
    attachment = createAttachment(user.id, {
      kind: 'image',
      relativePath,
      mimeType: file.type,
      sizeBytes: buffer.length,
      sha256,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
    });
  } catch (error) {
    await unlink(absolutePath).catch(() => undefined);
    throw error;
  }

  return NextResponse.json(
    successResponse({
      attachmentId: attachment.id,
      mimeType: file.type,
      sizeBytes: buffer.length,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
    }),
    { status: 201 },
  );
});
