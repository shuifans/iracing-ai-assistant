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
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Allowed MIME types for chat image uploads. */
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Maximum file size: 10 MB. */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Maximum image dimension (longest edge) in pixels. */
const MAX_DIMENSION = 8192;

/** MIME type → file extension mapping. */
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * POST /api/uploads/images — upload a chat image, return attachment ID.
 */
export const POST = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const user = await requireAuth(request);
  requireActiveUser(user);
  validateOrigin(request);

  const formData = await request.formData();
  const file = formData.get('file');

  if (!file || !(file instanceof Blob)) {
    throw new AppError('VALIDATION_ERROR', '未提供文件');
  }

  // Validate MIME type
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new AppError('VALIDATION_ERROR', '仅支持 JPEG、PNG、WebP 格式');
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    throw new AppError('VALIDATION_ERROR', '文件大小不能超过 10MB');
  }

  // Read file buffer
  const buffer = Buffer.from(await file.arrayBuffer());

  // Parse image dimensions
  const dimensions = getImageDimensions(buffer, file.type);
  if (dimensions) {
    const longestEdge = Math.max(dimensions.width, dimensions.height);
    if (longestEdge > MAX_DIMENSION) {
      throw new AppError('VALIDATION_ERROR', `图片最长边不能超过 ${MAX_DIMENSION}px`);
    }
  }

  // Compute SHA-256
  const sha256 = createHash('sha256').update(buffer).digest('hex');

  // Generate path: /data/uploads/chat/YYYY/MM/<uuid>.<ext>
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const uuid = generateId();
  const ext = MIME_TO_EXT[file.type]!;
  const relativePath = `chat/${year}/${month}/${uuid}.${ext}`;
  const absolutePath = join('/data/uploads', relativePath);

  // Ensure directory exists and write file
  const dir = join('/data/uploads', `chat/${year}/${month}`);
  await mkdir(dir, { recursive: true });
  await writeFile(absolutePath, buffer);

  // Create attachment record (without messageId — will be linked when message is created)
  // We use a temporary empty string for messageId; the real link happens at message creation.
  const attachment = createAttachment('', {
    kind: 'image',
    relativePath,
    mimeType: file.type,
    sizeBytes: buffer.length,
    sha256,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
  });

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

/**
 * Parse image dimensions from buffer header (supports JPEG, PNG, WebP).
 */
function getImageDimensions(
  buffer: Buffer,
  mimeType: string,
): { width: number; height: number } | null {
  try {
    if (mimeType === 'image/png' && buffer.length >= 24) {
      // PNG: IHDR chunk at offset 16 (width) and 20 (height), 4 bytes each, big-endian
      if (buffer.readUInt8(0) === 0x89 && buffer.readUInt8(1) === 0x50) {
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);
        return { width, height };
      }
    }

    if (mimeType === 'image/jpeg' && buffer.length >= 4) {
      // JPEG: scan for SOF0/SOF2 marker
      let offset = 2;
      while (offset < buffer.length - 8) {
        if (buffer.readUInt8(offset) !== 0xff) break;
        const marker = buffer.readUInt8(offset + 1);
        // SOF0 (0xC0) or SOF2 (0xC2)
        if (marker === 0xc0 || marker === 0xc2) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return { width, height };
        }
        const segmentLength = buffer.readUInt16BE(offset + 2);
        offset += 2 + segmentLength;
      }
    }

    if (mimeType === 'image/webp' && buffer.length >= 30) {
      // WebP: RIFF header, then VP8 / VP8L / VP8X chunk
      if (
        buffer.readUInt8(0) === 0x52 &&
        buffer.readUInt8(1) === 0x49 &&
        buffer.readUInt8(2) === 0x46 &&
        buffer.readUInt8(3) === 0x46
      ) {
        const chunkType = buffer.toString('ascii', 12, 16);
        if (chunkType === 'VP8 ' && buffer.length >= 30) {
          // Lossy: frame tag at offset 26 (width LE 16-bit) and 28 (height LE 16-bit)
          const width = buffer.readUInt16LE(26) & 0x3fff;
          const height = buffer.readUInt16LE(28) & 0x3fff;
          return { width, height };
        }
        if (chunkType === 'VP8L' && buffer.length >= 25) {
          // Lossless: 14-bit width and height packed in 4 bytes at offset 21
          const b0 = buffer.readUInt8(21);
          const b1 = buffer.readUInt8(22);
          const b2 = buffer.readUInt8(23);
          const b3 = buffer.readUInt8(24);
          const width = 1 + (((b1 & 0x3f) << 8) | b0);
          const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
          return { width, height };
        }
        if (chunkType === 'VP8X' && buffer.length >= 30) {
          // Extended: width (24-bit LE) at offset 24, height (24-bit LE) at offset 27
          const width =
            1 + (buffer.readUInt8(24) | (buffer.readUInt8(25) << 8) | (buffer.readUInt8(26) << 16));
          const height =
            1 + (buffer.readUInt8(27) | (buffer.readUInt8(28) << 8) | (buffer.readUInt8(29) << 16));
          return { width, height };
        }
      }
    }
  } catch {
    // If dimension parsing fails, return null (skip dimension validation)
  }
  return null;
}
