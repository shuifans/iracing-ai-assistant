/**
 * DOCX extractor using mammoth.
 *
 * @module knowledge/extractors/docx
 */

import mammoth from 'mammoth';
import type { ExtractionResult } from '@/modules/knowledge/types';
import { AppError } from '@/lib/errors';

/** Max extracted text length in characters (2 MB). */
const MAX_TEXT_CHARS = 2_097_152;

/**
 * Extract plain text from a DOCX buffer using mammoth.
 *
 * @throws {AppError} EXTRACTION_FAILED if mammoth fails or document is empty.
 */
export async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  let result: mammoth.ExtractedContent;

  try {
    result = await mammoth.extractRawText({ buffer });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AppError('EXTRACTION_FAILED', `DOCX extraction failed: ${message}`);
  }

  const text = result.value;

  if (!text || text.trim().length === 0) {
    throw new AppError('EXTRACTION_FAILED', 'The uploaded DOCX file contains no extractable text');
  }

  const warnings: string[] = [];

  // Surface mammoth warnings (e.g. unsupported formatting)
  if (result.messages && result.messages.length > 0) {
    for (const msg of result.messages) {
      warnings.push(`mammoth: ${msg.message}`);
    }
  }

  // Truncation
  const truncated = text.length > MAX_TEXT_CHARS;
  const trimmed = truncated ? text.slice(0, MAX_TEXT_CHARS) : text;

  if (truncated) {
    warnings.push(`Text truncated to ${MAX_TEXT_CHARS} characters`);
  }

  return {
    text: trimmed,
    charCount: trimmed.length,
    truncated,
    warnings,
  };
}
