/**
 * Plain text / Markdown extractor.
 *
 * @module knowledge/extractors/text
 */

import type { ExtractionResult } from '../types';
import { AppError } from '@/lib/errors';

/** 2 MB character limit for extracted text. */
const MAX_CHARS = 2 * 1024 * 1024;

export async function extractText(buffer: Buffer): Promise<ExtractionResult> {
  const text = buffer.toString('utf-8');

  if (text.length === 0) {
    throw new AppError('EXTRACTION_FAILED', 'The uploaded file is empty');
  }

  const truncated = text.length > MAX_CHARS;
  const trimmed = truncated ? text.slice(0, MAX_CHARS) : text;
  const warnings: string[] = [];

  if (truncated) {
    warnings.push(`Text truncated: original ${text.length} chars exceeds ${MAX_CHARS} char limit`);
  }

  return {
    text: trimmed,
    charCount: trimmed.length,
    truncated,
    warnings,
  };
}
