import type { ExtractionResult } from '@/modules/knowledge/types';
import { AppError } from '@/lib/errors';
import { extractText } from './text';
import { extractMarkdown } from './markdown';

/**
 * Unified extraction entry point.
 * Dispatches to the appropriate extractor based on MIME type.
 *
 * Currently supported:
 * - `text/plain` → extractText
 * - `text/markdown` → extractMarkdown
 *
 * Unsupported MIME types throw AppError(EXTRACTION_FAILED).
 * Future extractors (docx/pdf/excel/url) will be added here.
 */
export async function extract(buffer: Buffer, mimeType: string): Promise<ExtractionResult> {
  switch (mimeType) {
    case 'text/plain':
      return extractText(buffer, mimeType);

    case 'text/markdown':
      return extractMarkdown(buffer);

    default:
      throw new AppError(
        'EXTRACTION_FAILED',
        `Unsupported MIME type for extraction: ${mimeType}`,
      );
  }
}
