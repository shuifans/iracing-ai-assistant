import { describe, it, expect } from 'vitest';
import { extractMarkdown } from '@/modules/knowledge/extractors/markdown';

// ─── 正常 Markdown ────────────────────────────────────────────────────────────

describe('extractMarkdown', () => {
  it('保留标题结构', () => {
    const input = '# Heading 1\n\n## Heading 2\n\nBody text';
    const buffer = Buffer.from(input, 'utf-8');

    const result = extractMarkdown(buffer);

    expect(result.text).toBe(input);
    expect(result.charCount).toBe(input.length);
    expect(result.truncated).toBe(false);
  });

  it('保留列表结构', () => {
    const input = '- Item 1\n- Item 2\n  - Nested item\n- Item 3';
    const buffer = Buffer.from(input, 'utf-8');

    const result = extractMarkdown(buffer);

    expect(result.text).toBe(input);
  });

  it('保留链接和代码块', () => {
    const input = 'See [docs](https://example.com).\n\n```typescript\nconst x = 1;\n```';
    const buffer = Buffer.from(input, 'utf-8');

    const result = extractMarkdown(buffer);

    expect(result.text).toBe(input);
  });

  // ─── BOM 剥离 ───────────────────────────────────────────────────────────────

  it('剥离 UTF-8 BOM', () => {
    const content = '# Title\nContent after BOM';
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const body = Buffer.from(content, 'utf-8');
    const buffer = Buffer.concat([bom, body]);

    const result = extractMarkdown(buffer);

    expect(result.text).toBe(content);
    expect(result.charCount).toBe(content.length);
  });

  // ─── 危险 HTML 标签清除 ───────────────────────────────────────────────────────

  it('移除嵌入的 <script> 标签，保留 Markdown 结构', () => {
    const input = '# Safe Title\n\n<script>evil()</script>\n\nParagraph text';
    const buffer = Buffer.from(input, 'utf-8');

    const result = extractMarkdown(buffer);

    expect(result.text).toBe('# Safe Title\n\n\n\nParagraph text');
    expect(result.warnings).toContain('Dangerous HTML tags were removed');
  });

  it('移除 <iframe> 标签', () => {
    const input = 'Content <iframe src="x"></iframe> more';
    const buffer = Buffer.from(input, 'utf-8');

    const result = extractMarkdown(buffer);

    expect(result.text).toBe('Content  more');
  });

  it('移除 <object> 标签', () => {
    const input = '<object data="bad"></object>Text';
    const buffer = Buffer.from(input, 'utf-8');

    const result = extractMarkdown(buffer);

    expect(result.text).toBe('Text');
  });

  it('无危险标签时不产生 warning', () => {
    const input = '# Clean Markdown\n\nNo HTML here.';
    const buffer = Buffer.from(input, 'utf-8');

    const result = extractMarkdown(buffer);

    expect(result.warnings).toEqual([]);
  });

  // ─── 超大截断 ───────────────────────────────────────────────────────────────

  it('超过 2MB 截断并设置 truncated=true', () => {
    const MAX_TEXT_CHARS = 2_097_152;
    const oversized = '# Title\n\n' + 'a'.repeat(MAX_TEXT_CHARS);
    const buffer = Buffer.from(oversized, 'utf-8');

    const result = extractMarkdown(buffer);

    expect(result.text.length).toBe(MAX_TEXT_CHARS);
    expect(result.truncated).toBe(true);
    expect(result.charCount).toBe(oversized.length);
  });

  it('恰好等于 2MB 不截断', () => {
    const MAX_TEXT_CHARS = 2_097_152;
    const exact = 'a'.repeat(MAX_TEXT_CHARS);
    const buffer = Buffer.from(exact, 'utf-8');

    const result = extractMarkdown(buffer);

    expect(result.text.length).toBe(MAX_TEXT_CHARS);
    expect(result.truncated).toBe(false);
  });
});
