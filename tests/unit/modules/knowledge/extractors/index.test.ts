import { describe, it, expect } from 'vitest';
import { extract } from '@/modules/knowledge/extractors';
import { AppError } from '@/lib/errors';

// ─── text/plain 分发 ─────────────────────────────────────────────────────────

describe('extract (dispatcher)', () => {
  it('text/plain → extractText', async () => {
    const input = 'Plain text content';
    const buffer = Buffer.from(input, 'utf-8');

    const result = await extract(buffer, 'text/plain');

    expect(result.text).toBe(input);
    expect(result.truncated).toBe(false);
  });

  it('text/plain 带 BOM 正确剥离', async () => {
    const content = 'After BOM';
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const body = Buffer.from(content, 'utf-8');
    const buffer = Buffer.concat([bom, body]);

    const result = await extract(buffer, 'text/plain');

    expect(result.text).toBe(content);
  });

  // ─── text/markdown 分发 ─────────────────────────────────────────────────────

  it('text/markdown → extractMarkdown', async () => {
    const input = '# Markdown Title\n\n- list item';
    const buffer = Buffer.from(input, 'utf-8');

    const result = await extract(buffer, 'text/markdown');

    expect(result.text).toBe(input);
  });

  it('text/markdown 正确移除危险标签', async () => {
    const input = '# Title\n<script>bad</script>\nContent';
    const buffer = Buffer.from(input, 'utf-8');

    const result = await extract(buffer, 'text/markdown');

    expect(result.text).not.toContain('<script>');
  });

  // ─── 不支持的 MIME ───────────────────────────────────────────────────────────

  it('application/pdf 抛出 AppError(EXTRACTION_FAILED)', async () => {
    const buffer = Buffer.from('fake pdf', 'utf-8');

    await expect(extract(buffer, 'application/pdf')).rejects.toThrow(AppError);
    await expect(extract(buffer, 'application/pdf')).rejects.toMatchObject({
      code: 'EXTRACTION_FAILED',
    });
  });

  it('application/vnd.openxmlformats-officedocument.wordprocessingml.document 抛出 AppError', async () => {
    const buffer = Buffer.from('fake docx', 'utf-8');

    await expect(
      extract(
        buffer,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).rejects.toMatchObject({ code: 'EXTRACTION_FAILED' });
  });

  it('unknown/type 抛出 AppError(EXTRACTION_FAILED)', async () => {
    const buffer = Buffer.from('unknown', 'utf-8');

    await expect(extract(buffer, 'unknown/type')).rejects.toMatchObject({
      code: 'EXTRACTION_FAILED',
    });
  });
});
