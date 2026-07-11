import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/lib/errors';

// Mock mammoth before importing the extractor
vi.mock('mammoth', () => ({
  default: {
    extractRawText: vi.fn(),
  },
  extractRawText: vi.fn(),
}));

import mammoth from 'mammoth';
import { extractDocx } from '@/modules/knowledge/extractors/docx';

const mockExtractRawText = vi.mocked(mammoth.extractRawText);

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── extractDocx ──────────────────────────────────────────────────────────────

describe('extractDocx', () => {
  it('正常抽取 DOCX 文本', async () => {
    const sampleText = 'Hello World\nThis is a sample document.';
    mockExtractRawText.mockResolvedValue({ value: sampleText, messages: [] } as any);

    const result = await extractDocx(Buffer.from('fake-docx'));

    expect(result.text).toBe(sampleText);
    expect(result.charCount).toBe(sampleText.length);
    expect(result.truncated).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(mockExtractRawText).toHaveBeenCalledWith({ buffer: expect.any(Buffer) });
  });

  it('包含 mammoth 警告时透传 warnings', async () => {
    mockExtractRawText.mockResolvedValue({
      value: 'Some text',
      messages: [{ message: 'Unrecognised paragraph style', type: 'warning' }],
    } as any);

    const result = await extractDocx(Buffer.from('fake-docx'));

    expect(result.warnings).toEqual(['mammoth: Unrecognised paragraph style']);
  });

  it('mammoth 抛出错误 → AppError EXTRACTION_FAILED', async () => {
    mockExtractRawText.mockRejectedValue(new Error('Bad file'));

    await expect(extractDocx(Buffer.from('bad'))).rejects.toThrow(AppError);
    await expect(extractDocx(Buffer.from('bad'))).rejects.toMatchObject({
      code: 'EXTRACTION_FAILED',
    });
  });

  it('空文档（无文本）→ AppError EXTRACTION_FAILED', async () => {
    mockExtractRawText.mockResolvedValue({ value: '', messages: [] } as any);

    await expect(extractDocx(Buffer.from('empty'))).rejects.toMatchObject({
      code: 'EXTRACTION_FAILED',
    });
  });

  it('仅空白字符的文档 → AppError EXTRACTION_FAILED', async () => {
    mockExtractRawText.mockResolvedValue({ value: '   \n\t  ', messages: [] } as any);

    await expect(extractDocx(Buffer.from('whitespace'))).rejects.toMatchObject({
      code: 'EXTRACTION_FAILED',
    });
  });

  it('超长文本截断至 2MB', async () => {
    const longText = 'x'.repeat(2 * 1024 * 1024 + 100);
    mockExtractRawText.mockResolvedValue({ value: longText, messages: [] } as any);

    const result = await extractDocx(Buffer.from('long-docx'));

    expect(result.charCount).toBe(2 * 1024 * 1024);
    expect(result.truncated).toBe(true);
    expect(result.warnings.some((w) => w.includes('truncated') || w.includes('Truncated'))).toBe(
      true,
    );
  });
});
