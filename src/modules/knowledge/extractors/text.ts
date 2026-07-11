import type { ExtractionResult } from '@/modules/knowledge/types';

/** Max extracted text length in characters (2 MB). */
const MAX_TEXT_CHARS = 2_097_152;

/** UTF-8 BOM bytes. */
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/**
 * Strip dangerous HTML elements (tags + inner content) from text.
 * Removes <script>, <iframe>, <object> entirely (case-insensitive).
 */
function stripDangerousHtml(input: string): string {
  // Pass 1: remove full elements including their content
  let result = input.replace(
    /<(script|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    '',
  );
  // Pass 2: remove any remaining orphan tags
  result = result.replace(/<\/?(?:script|iframe|object)\b[^>]*>/gi, '');
  return result;
}

/**
 * Strip UTF-8 BOM prefix if present.
 */
function stripBom(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) {
    return text.slice(1);
  }
  return text;
}

/**
 * Extract plain text from a Buffer.
 *
 * Steps:
 * 1. UTF-8 decode
 * 2. BOM stripping
 * 3. Dangerous HTML tag removal (always applied — safe for plain text)
 * 4. Truncation to 2 MB if necessary
 */
export function extractText(buffer: Buffer, _mimeType: string): ExtractionResult {
  const warnings: string[] = [];

  // 1. UTF-8 decode
  let text = buffer.toString('utf-8');

  // 2. BOM stripping
  text = stripBom(text);

  // 3. Dangerous HTML tag removal
  const stripped = stripDangerousHtml(text);
  if (stripped.length !== text.length) {
    warnings.push('Dangerous HTML tags were removed');
  }
  text = stripped;

  // 4. Truncation
  const originalCharCount = text.length;
  let truncated = false;

  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
    truncated = true;
    warnings.push(`Text truncated to ${MAX_TEXT_CHARS} characters`);
  }

  return {
    text,
    charCount: originalCharCount,
    truncated,
    warnings,
  };
}
