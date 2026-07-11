import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/lib/errors';

// Mock pdf-parse before importing the extractor
const mockGetText = vi.fn();
const mockDestroy = vi.fn();

vi.mock('pdf-parse', () => {
  return {
    PDFParse: class MockPDFParse {
      getText = mockGetText;
      destroy = mockDestroy;
    },
  };
});

import { PDFParse } from 'pdf-parse';
import { extractPdf } from '@/modules/knowledge/extractors/pdf';

beforeEach(() => {
  vi.clearAllMocks();
  mockDestroy.mockResolvedValue(undefined);
});

// ─── extractPdf ───────────────────────────────────────────────────────────────

describe('extractPdf', () => {
  it('正常抽取 PDF 文本（>= 200 字符）', async () => {
    const sampleText = 'A'.repeat(250);
    mockGetText.mockResolvedValue({ text: sampleText, pages: [], total: 1 });

    const result = await extractPdf(Buffer.from('fake-pdf'));

    expect(result.text).toBe(sampleText);
    expect(result.charCount).toBe(sampleText.length);
    expect(result.truncated).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(mockDestroy).toHaveBeenCalledOnce();
  });

  it('抽取后调用 destroy 即使 getText 失败', async () => {
    mockGetText.mockRejectedValue(new Error('Parse error'));

    await expect(extractPdf(Buffer.from('bad-pdf'))).rejects.toThrow(AppError);
    expect(mockDestroy).toHaveBeenCalledOnce();
  });

  it('PDF 文本少于 200 字符 → AppError PDF_OCR_REQUIRED', async () => {
    mockGetText.mockResolvedValue({ text: 'short text', pages: [], total: 1 });

    await expect(extractPdf(Buffer.from('scanned-pdf'))).rejects.toMatchObject({
      code: 'PDF_OCR_REQUIRED',
    });
  });

  it('恰好 200 字符不触发 OCR 错误', async () => {
    const text = 'A'.repeat(200);
    mockGetText.mockResolvedValue({ text, pages: [], total: 1 });

    const result = await extractPdf(Buffer.from('borderline-pdf'));

    expect(result.text).toBe(text);
  });

  it('pdf-parse 抛出错误 → AppError EXTRACTION_FAILED', async () => {
    mockGetText.mockRejectedValue(new Error('Corrupt PDF'));

    await expect(extractPdf(Buffer.from('corrupt'))).rejects.toMatchObject({
      code: 'EXTRACTION_FAILED',
    });
  });

  it('超长文本截断至 2MB', async () => {
    const longText = 'y'.repeat(2 * 1024 * 1024 + 500);
    mockGetText.mockResolvedValue({ text: longText, pages: [], total: 100 });

    const result = await extractPdf(Buffer.from('long-pdf'));

    expect(result.charCount).toBe(2 * 1024 * 1024);
    expect(result.truncated).toBe(true);
    expect(result.warnings.some((w) => w.includes('truncated') || w.includes('Truncated'))).toBe(
      true,
    );
  });
});
