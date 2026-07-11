/**
 * Image upload validation tests.
 *
 * Tests the image validation logic (magic bytes, MIME type, file size)
 * used by the chat image upload endpoint.
 */

import { describe, it, expect } from 'vitest';
import {
  detectImageMagicBytes,
  getImageDimensions,
  validateImageUpload,
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_FILE_SIZE,
  MAX_IMAGE_DIMENSION,
  MIME_TO_EXT,
} from '@/lib/image-validation';

// ---------------------------------------------------------------------------
// Buffer builders — minimal valid image headers
// ---------------------------------------------------------------------------

/** Build a minimal JPEG buffer with SOI + SOF0 marker containing dimensions. */
function buildJpegBuffer(width: number, height: number): Buffer {
  // SOI (2) + SOF0 marker segment: FF C0, length=11, precision=8, height(2), width(2), components=3, ...
  const buf = Buffer.alloc(32);
  buf[0] = 0xff;
  buf[1] = 0xd8; // SOI
  buf[2] = 0xff;
  buf[3] = 0xc0; // SOF0
  buf[4] = 0x00;
  buf[5] = 0x0b; // segment length = 11
  buf[6] = 0x08; // precision = 8
  buf.writeUInt16BE(height, 7); // height
  buf.writeUInt16BE(width, 9); // width
  buf[11] = 0x03; // 3 components
  return buf;
}

/** Build a minimal PNG buffer with IHDR chunk containing dimensions. */
function buildPngBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(32);
  // PNG signature
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  buf[4] = 0x0d;
  buf[5] = 0x0a;
  buf[6] = 0x1a;
  buf[7] = 0x0a;
  // IHDR chunk length (13 bytes)
  buf[8] = 0x00;
  buf[9] = 0x00;
  buf[10] = 0x00;
  buf[11] = 0x0d;
  // Chunk type: IHDR
  buf[12] = 0x49;
  buf[13] = 0x48;
  buf[14] = 0x44;
  buf[15] = 0x52;
  // Width (4 bytes big-endian) at offset 16
  buf.writeUInt32BE(width, 16);
  // Height (4 bytes big-endian) at offset 20
  buf.writeUInt32BE(height, 20);
  return buf;
}

/** Build a minimal WebP (lossy VP8) buffer with dimensions. */
function buildWebPBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(40);
  // RIFF header
  buf[0] = 0x52;
  buf[1] = 0x49;
  buf[2] = 0x46;
  buf[3] = 0x46; // RIFF
  buf.writeUInt32LE(32, 4); // file size - 8
  buf[8] = 0x57;
  buf[9] = 0x45;
  buf[10] = 0x42;
  buf[11] = 0x50; // WEBP
  // VP8 chunk
  buf[12] = 0x56;
  buf[13] = 0x50;
  buf[14] = 0x38;
  buf[15] = 0x20; // "VP8 "
  buf.writeUInt32LE(20, 16); // chunk size
  // Frame tag (3 bytes at offset 20) — simple keyframe
  buf[20] = 0x9d;
  buf[21] = 0x01;
  buf[22] = 0x2a;
  // Width (16-bit LE) at offset 26 (masked with 0x3fff)
  buf.writeUInt16LE(width & 0x3fff, 26);
  // Height (16-bit LE) at offset 28 (masked with 0x3fff)
  buf.writeUInt16LE(height & 0x3fff, 28);
  return buf;
}

// ---------------------------------------------------------------------------
// 1. JPEG magic bytes
// ---------------------------------------------------------------------------

describe('detectImageMagicBytes — JPEG', () => {
  it('detects JPEG from FF D8 FF magic bytes', () => {
    const buf = buildJpegBuffer(800, 600);
    expect(detectImageMagicBytes(buf)).toBe('image/jpeg');
  });

  it('detects JPEG from minimal 3-byte prefix (with padding)', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]);
    expect(detectImageMagicBytes(buf)).toBe('image/jpeg');
  });
});

// ---------------------------------------------------------------------------
// 2. PNG magic bytes
// ---------------------------------------------------------------------------

describe('detectImageMagicBytes — PNG', () => {
  it('detects PNG from 89 50 4E 47 magic bytes', () => {
    const buf = buildPngBuffer(1024, 768);
    expect(detectImageMagicBytes(buf)).toBe('image/png');
  });

  it('detects PNG from minimal signature', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectImageMagicBytes(buf)).toBe('image/png');
  });
});

// ---------------------------------------------------------------------------
// 3. WebP magic bytes
// ---------------------------------------------------------------------------

describe('detectImageMagicBytes — WebP', () => {
  it('detects WebP from RIFF...WEBP header', () => {
    const buf = buildWebPBuffer(640, 480);
    expect(detectImageMagicBytes(buf)).toBe('image/webp');
  });

  it('detects WebP from minimal RIFF header', () => {
    const buf = Buffer.from([
      0x52,
      0x49,
      0x46,
      0x46, // RIFF
      0x00,
      0x00,
      0x00,
      0x00, // size
      0x57,
      0x45,
      0x42,
      0x50, // WEBP
    ]);
    expect(detectImageMagicBytes(buf)).toBe('image/webp');
  });
});

// ---------------------------------------------------------------------------
// 4. Non-image format rejection
// ---------------------------------------------------------------------------

describe('detectImageMagicBytes — non-image rejection', () => {
  it('returns null for GIF (47 49 46 38)', () => {
    const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(detectImageMagicBytes(buf)).toBeNull();
  });

  it('returns null for BMP (42 4D)', () => {
    const buf = Buffer.from([0x42, 0x4d, 0x00, 0x00, 0x00, 0x00]);
    expect(detectImageMagicBytes(buf)).toBeNull();
  });

  it('returns null for PDF (25 50 44 46)', () => {
    const buf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    expect(detectImageMagicBytes(buf)).toBeNull();
  });

  it('returns null for plain text', () => {
    const buf = Buffer.from('Hello, this is not an image', 'utf-8');
    expect(detectImageMagicBytes(buf)).toBeNull();
  });

  it('returns null for empty buffer', () => {
    expect(detectImageMagicBytes(Buffer.alloc(0))).toBeNull();
  });

  it('returns null for buffer smaller than 4 bytes', () => {
    expect(detectImageMagicBytes(Buffer.from([0xff, 0xd8]))).toBeNull();
  });

  it('validateImageUpload rejects non-image MIME type', () => {
    const buf = buildJpegBuffer(800, 600);
    const result = validateImageUpload(buf, 'image/gif');
    expect(result).not.toBeNull();
    expect(result!.error).toContain('JPEG');
  });

  it('validateImageUpload rejects text/plain MIME type', () => {
    const buf = Buffer.from('plain text content');
    const result = validateImageUpload(buf, 'text/plain');
    expect(result).not.toBeNull();
  });

  it('validateImageUpload rejects application/pdf MIME type', () => {
    const buf = Buffer.from([0x25, 0x50, 0x44, 0x46]);
    const result = validateImageUpload(buf, 'application/pdf');
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Oversized file rejection (> 10MB)
// ---------------------------------------------------------------------------

describe('validateImageUpload — oversized file', () => {
  it('rejects JPEG file larger than 10MB', () => {
    // Create a buffer just over 10MB with JPEG magic bytes
    const size = MAX_IMAGE_FILE_SIZE + 1;
    const buf = Buffer.alloc(size);
    buf[0] = 0xff;
    buf[1] = 0xd8;
    buf[2] = 0xff; // JPEG magic
    const result = validateImageUpload(buf, 'image/jpeg');
    expect(result).not.toBeNull();
    expect(result!.error).toContain('10MB');
  });

  it('rejects PNG file larger than 10MB', () => {
    const size = MAX_IMAGE_FILE_SIZE + 100;
    const buf = Buffer.alloc(size);
    buf[0] = 0x89;
    buf[1] = 0x50;
    buf[2] = 0x4e;
    buf[3] = 0x47; // PNG magic
    const result = validateImageUpload(buf, 'image/png');
    expect(result).not.toBeNull();
    expect(result!.error).toContain('10MB');
  });

  it('accepts file exactly at 10MB limit', () => {
    const buf = buildJpegBuffer(800, 600);
    // Pad to exactly MAX_IMAGE_FILE_SIZE
    const padded = Buffer.alloc(MAX_IMAGE_FILE_SIZE);
    buf.copy(padded);
    const result = validateImageUpload(padded, 'image/jpeg');
    expect(result).toBeNull(); // null = valid
  });

  it('rejects file at 10MB + 1 byte', () => {
    const buf = buildJpegBuffer(800, 600);
    const padded = Buffer.alloc(MAX_IMAGE_FILE_SIZE + 1);
    buf.copy(padded);
    const result = validateImageUpload(padded, 'image/jpeg');
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. MIME type validation
// ---------------------------------------------------------------------------

describe('ALLOWED_IMAGE_MIME_TYPES', () => {
  it('includes image/jpeg', () => {
    expect(ALLOWED_IMAGE_MIME_TYPES.has('image/jpeg')).toBe(true);
  });

  it('includes image/png', () => {
    expect(ALLOWED_IMAGE_MIME_TYPES.has('image/png')).toBe(true);
  });

  it('includes image/webp', () => {
    expect(ALLOWED_IMAGE_MIME_TYPES.has('image/webp')).toBe(true);
  });

  it('excludes image/gif', () => {
    expect(ALLOWED_IMAGE_MIME_TYPES.has('image/gif')).toBe(false);
  });

  it('excludes image/bmp', () => {
    expect(ALLOWED_IMAGE_MIME_TYPES.has('image/bmp')).toBe(false);
  });

  it('contains exactly 3 types', () => {
    expect(ALLOWED_IMAGE_MIME_TYPES.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 7. MIME to extension mapping
// ---------------------------------------------------------------------------

describe('MIME_TO_EXT', () => {
  it('maps image/jpeg to jpg', () => {
    expect(MIME_TO_EXT['image/jpeg']).toBe('jpg');
  });

  it('maps image/png to png', () => {
    expect(MIME_TO_EXT['image/png']).toBe('png');
  });

  it('maps image/webp to webp', () => {
    expect(MIME_TO_EXT['image/webp']).toBe('webp');
  });
});

// ---------------------------------------------------------------------------
// 8. Image dimension parsing
// ---------------------------------------------------------------------------

describe('getImageDimensions', () => {
  it('parses PNG dimensions from IHDR chunk', () => {
    const buf = buildPngBuffer(1920, 1080);
    const dims = getImageDimensions(buf, 'image/png');
    expect(dims).not.toBeNull();
    expect(dims!.width).toBe(1920);
    expect(dims!.height).toBe(1080);
  });

  it('parses JPEG dimensions from SOF0 marker', () => {
    const buf = buildJpegBuffer(3840, 2160);
    const dims = getImageDimensions(buf, 'image/jpeg');
    expect(dims).not.toBeNull();
    expect(dims!.width).toBe(3840);
    expect(dims!.height).toBe(2160);
  });

  it('parses WebP (VP8 lossy) dimensions', () => {
    const buf = buildWebPBuffer(640, 480);
    const dims = getImageDimensions(buf, 'image/webp');
    expect(dims).not.toBeNull();
    expect(dims!.width).toBe(640);
    expect(dims!.height).toBe(480);
  });

  it('returns null for too-short buffer', () => {
    const buf = Buffer.alloc(2);
    expect(getImageDimensions(buf, 'image/png')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. Dimension limit validation
// ---------------------------------------------------------------------------

describe('validateImageUpload — dimension limit', () => {
  it('rejects PNG with longest edge exceeding MAX_IMAGE_DIMENSION', () => {
    const buf = buildPngBuffer(MAX_IMAGE_DIMENSION + 1, 1000);
    const result = validateImageUpload(buf, 'image/png');
    expect(result).not.toBeNull();
    expect(result!.error).toContain(`${MAX_IMAGE_DIMENSION}px`);
  });

  it('accepts PNG at exactly MAX_IMAGE_DIMENSION', () => {
    const buf = buildPngBuffer(MAX_IMAGE_DIMENSION, 1000);
    const result = validateImageUpload(buf, 'image/png');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 10. Magic bytes vs MIME mismatch
// ---------------------------------------------------------------------------

describe('validateImageUpload — magic bytes mismatch', () => {
  it('rejects JPEG magic bytes with PNG MIME type', () => {
    const buf = buildJpegBuffer(800, 600);
    const result = validateImageUpload(buf, 'image/png');
    expect(result).not.toBeNull();
    expect(result!.error).toContain('MIME');
  });

  it('rejects PNG magic bytes with JPEG MIME type', () => {
    const buf = buildPngBuffer(800, 600);
    const result = validateImageUpload(buf, 'image/jpeg');
    expect(result).not.toBeNull();
    expect(result!.error).toContain('MIME');
  });
});

// ---------------------------------------------------------------------------
// 11. Valid upload end-to-end
// ---------------------------------------------------------------------------

describe('validateImageUpload — valid uploads', () => {
  it('accepts valid JPEG upload', () => {
    const buf = buildJpegBuffer(800, 600);
    expect(validateImageUpload(buf, 'image/jpeg')).toBeNull();
  });

  it('accepts valid PNG upload', () => {
    const buf = buildPngBuffer(1024, 768);
    expect(validateImageUpload(buf, 'image/png')).toBeNull();
  });

  it('accepts valid WebP upload', () => {
    const buf = buildWebPBuffer(640, 480);
    expect(validateImageUpload(buf, 'image/webp')).toBeNull();
  });
});
