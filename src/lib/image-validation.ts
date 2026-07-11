/**
 * Image validation utilities for chat uploads.
 *
 * Extracted from the uploads route to enable unit testing of
 * magic-bytes detection, MIME validation and file-size limits.
 *
 * @module chat/image-validation
 */

/** Allowed MIME types for chat image uploads. */
export const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Maximum file size: 10 MB. */
export const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024;

/** Maximum image dimension (longest edge) in pixels. */
export const MAX_IMAGE_DIMENSION = 8192;

/** MIME type → file extension mapping. */
export const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Detect image format from buffer magic bytes.
 * Returns the MIME type if recognized, or null if not an image.
 */
export function detectImageMagicBytes(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;

  // JPEG: starts with FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: starts with 89 50 4E 47 (‰PNG)
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }

  // WebP: RIFF....WEBP
  if (
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer.length >= 12 &&
    buffer[8] === 0x57 && // W
    buffer[9] === 0x45 && // E
    buffer[10] === 0x42 && // B
    buffer[11] === 0x50 // P
  ) {
    return 'image/webp';
  }

  return null;
}

/**
 * Parse image dimensions from buffer header (supports JPEG, PNG, WebP).
 */
export function getImageDimensions(
  buffer: Buffer,
  mimeType: string,
): { width: number; height: number } | null {
  try {
    if (mimeType === 'image/png' && buffer.length >= 24) {
      if (buffer.readUInt8(0) === 0x89 && buffer.readUInt8(1) === 0x50) {
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);
        return { width, height };
      }
    }

    if (mimeType === 'image/jpeg' && buffer.length >= 4) {
      let offset = 2;
      while (offset < buffer.length - 8) {
        if (buffer.readUInt8(offset) !== 0xff) break;
        const marker = buffer.readUInt8(offset + 1);
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
      if (
        buffer.readUInt8(0) === 0x52 &&
        buffer.readUInt8(1) === 0x49 &&
        buffer.readUInt8(2) === 0x46 &&
        buffer.readUInt8(3) === 0x46
      ) {
        const chunkType = buffer.toString('ascii', 12, 16);
        if (chunkType === 'VP8 ' && buffer.length >= 30) {
          const width = buffer.readUInt16LE(26) & 0x3fff;
          const height = buffer.readUInt16LE(28) & 0x3fff;
          return { width, height };
        }
        if (chunkType === 'VP8L' && buffer.length >= 25) {
          const b0 = buffer.readUInt8(21);
          const b1 = buffer.readUInt8(22);
          const b2 = buffer.readUInt8(23);
          const b3 = buffer.readUInt8(24);
          const width = 1 + (((b1 & 0x3f) << 8) | b0);
          const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
          return { width, height };
        }
        if (chunkType === 'VP8X' && buffer.length >= 30) {
          const width =
            1 + (buffer.readUInt8(24) | (buffer.readUInt8(25) << 8) | (buffer.readUInt8(26) << 16));
          const height =
            1 + (buffer.readUInt8(27) | (buffer.readUInt8(28) << 8) | (buffer.readUInt8(29) << 16));
          return { width, height };
        }
      }
    }
  } catch {
    // If dimension parsing fails, return null
  }
  return null;
}

/**
 * Validate an image upload buffer.
 * Returns an error message if invalid, or null if valid.
 */
export function validateImageUpload(buffer: Buffer, mimeType: string): { error: string } | null {
  // Check MIME type
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    return { error: '仅支持 JPEG、PNG、WebP 格式' };
  }

  // Check file size
  if (buffer.length > MAX_IMAGE_FILE_SIZE) {
    return { error: '文件大小不能超过 10MB' };
  }

  // Verify magic bytes match claimed MIME type
  const detected = detectImageMagicBytes(buffer);
  if (detected !== mimeType) {
    return { error: '文件内容与声明的 MIME 类型不匹配' };
  }

  // Check dimensions
  const dimensions = getImageDimensions(buffer, mimeType);
  if (dimensions) {
    const longestEdge = Math.max(dimensions.width, dimensions.height);
    if (longestEdge > MAX_IMAGE_DIMENSION) {
      return { error: `图片最长边不能超过 ${MAX_IMAGE_DIMENSION}px` };
    }
  }

  return null;
}
