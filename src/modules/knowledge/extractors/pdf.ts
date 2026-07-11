/**
 * PDF extractor using pdf-parse.
 *
 * @module knowledge/extractors/pdf
 */

import { PDFParse } from 'pdf-parse';
import type { ExtractionResult } from '@/modules/knowledge/types';
import { AppError } from '@/lib/errors';

/** Max extracted text length in characters (2 MB). */
const MAX_TEXT_CHARS = 2_097_152;

/**
 * Minimum number of meaningful characters required from a PDF.
 * Below this threshold the PDF is considered scan-only and requires OCR.
 */
const MIN_PDF_TEXT_CHARS = 200;

/**
 * Extract plain text from a PDF buffer.
 *
 * @throws {AppError} PDF_OCR_REQUIRED if extracted text is too short (likely scanned image).
 * @throws {AppError} EXTRACTION_FAILED if pdf-parse fails.
 */
export async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  let text: string;

  try {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      text = result.text;
    } finally {
      await parser.destroy();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AppError('EXTRACTION_FAILED', `PDF extraction failed: ${message}`);
  }

  // OCR guard: if the extracted text is too short, the PDF is likely a scanned image
  if (text.trim().length < MIN_PDF_TEXT_CHARS) {
    throw new AppError(
      'PDF_OCR_REQUIRED',
      `PDF contains insufficient extractable text (${text.trim().length} chars); OCR may be required`,
    );
  }

  const warnings: string[] = [];

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
