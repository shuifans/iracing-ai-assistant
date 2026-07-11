import type { ExtractionResult } from '@/modules/knowledge/types';
import { AppError } from '@/lib/errors';
import { extractText } from './text';
import { extractMarkdown } from './markdown';
import { extractDocx } from './docx';
import { extractPdf } from './pdf';
import { extractExcel } from './excel';

// Re-export URL fetcher (different signature — URL string, not buffer)
export { fetchUrl, type UrlFetchOptions } from './url';

/**
 * Unified extraction entry point.
 * Dispatches to the appropriate extractor based on MIME type.
 *
 * Supported MIME types:
 * - `text/plain` → extractText
 * - `text/markdown` → extractMarkdown
 * - `application/vnd.openxmlformats-officedocument.wordprocessingml.document` → extractDocx
 * - `application/pdf` → extractPdf
 * - `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` → extractExcel
 * - `application/vnd.ms-excel` → extractExcel
 *
 * Unsupported MIME types throw AppError(EXTRACTION_FAILED).
 */
export async function extract(buffer: Buffer, mimeType: string): Promise<ExtractionResult> {
  switch (mimeType) {
    case 'text/plain':
      return extractText(buffer, mimeType);

    case 'text/markdown':
      return extractMarkdown(buffer);

    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return extractDocx(buffer);

    case 'application/pdf':
      return extractPdf(buffer);

    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.ms-excel':
      return extractExcel(buffer, mimeType);

    default:
      throw new AppError(
        'EXTRACTION_FAILED',
        `Unsupported MIME type for extraction: ${mimeType}`,
      );
  }
}
