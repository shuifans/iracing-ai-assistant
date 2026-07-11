/**
 * Excel (.xlsx / .xls) extractor using the xlsx library.
 *
 * Each sheet is converted to a Markdown table. Sheets are separated by a
 * heading (`## SheetName`) and blank rows are trimmed.
 *
 * Limits:
 * - Max 50 sheets per workbook
 * - Max 10 000 rows per sheet
 * - Max 100 columns per row
 *
 * @module knowledge/extractors/excel
 */

import XLSX from 'xlsx';
import type { ExtractionResult } from '@/modules/knowledge/types';
import { AppError } from '@/lib/errors';

/** Max extracted text length in characters (2 MB). */
const MAX_TEXT_CHARS = 2_097_152;

const MAX_SHEETS = 50;
const MAX_ROWS_PER_SHEET = 10_000;
const MAX_COLS_PER_ROW = 100;

/**
 * Convert a 2-D array of cell values into a Markdown table string.
 * Empty trailing rows are trimmed.
 */
function toMarkdownTable(rows: unknown[][]): string {
  if (rows.length === 0) return '';

  // Determine the number of columns (clamped to MAX_COLS_PER_ROW)
  const colCount = Math.min(
    rows.reduce((max, row) => Math.max(max, row.length), 0),
    MAX_COLS_PER_ROW,
  );

  if (colCount === 0) return '';

  const normalise = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    return String(value);
  };

  // Build header row from the first data row
  const headerRow = rows[0];
  const header = `| ${Array.from({ length: colCount }, (_, c) => normalise(headerRow[c])).join(' | ')} |`;
  const separator = `| ${Array.from({ length: colCount }, () => '------').join(' | ')} |`;

  // Build data rows, skipping empty trailing rows
  const dataRows: string[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const cells = Array.from({ length: colCount }, (_, c) => normalise(row[c]));
    // Skip completely empty rows
    if (cells.every((c) => c === '')) continue;
    dataRows.push(`| ${cells.join(' | ')} |`);
  }

  return [header, separator, ...dataRows].join('\n');
}

/**
 * Extract text from an Excel workbook buffer.
 *
 * @throws {AppError} CONTENT_TOO_LARGE if the workbook exceeds sheet/row/column limits.
 * @throws {AppError} EXTRACTION_FAILED if parsing fails.
 */
export async function extractExcel(
  buffer: Buffer,
  _mimeType: string,
): Promise<ExtractionResult> {
  let workbook: XLSX.WorkBook;

  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AppError('EXTRACTION_FAILED', `Excel extraction failed: ${message}`);
  }

  const sheetNames = workbook.SheetNames ?? [];

  if (sheetNames.length === 0) {
    return { text: '', charCount: 0, truncated: false, warnings: ['Workbook contains no sheets'] };
  }

  if (sheetNames.length > MAX_SHEETS) {
    throw new AppError(
      'CONTENT_TOO_LARGE',
      `Workbook contains ${sheetNames.length} sheets; limit is ${MAX_SHEETS}`,
    );
  }

  const warnings: string[] = [];
  const parts: string[] = [];

  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;

    // Read as array-of-arrays; cell formulas use cached values (cell.v)
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    if (rows.length > MAX_ROWS_PER_SHEET) {
      throw new AppError(
        'CONTENT_TOO_LARGE',
        `Sheet "${name}" contains ${rows.length} rows; limit is ${MAX_ROWS_PER_SHEET}`,
      );
    }

    // Check column count in each row
    for (const row of rows) {
      if (Array.isArray(row) && row.length > MAX_COLS_PER_ROW) {
        throw new AppError(
          'CONTENT_TOO_LARGE',
          `Sheet "${name}" contains a row with ${row.length} columns; limit is ${MAX_COLS_PER_ROW}`,
        );
      }
    }

    const table = toMarkdownTable(rows);
    if (table.length > 0) {
      parts.push(`## ${name}\n\n${table}`);
    }
  }

  const text = parts.join('\n\n');
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
