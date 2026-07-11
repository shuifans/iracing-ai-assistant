import { describe, it, expect } from 'vitest';
import { extractText } from '@/modules/knowledge/extractors/text';

// ─── 正常 UTF-8 文本 ─────────────────────────────────────────────────────────

describe('extractText', () => {
  it('正常 UTF-8 文本', () => {
    const input = 'Hello, world! 你好世界';
    const buffer = Buffer.from(input, 'utf-8');

    const result = extractText(buffer, 'text/plain');

    expect(result.text).toBe(input);
    expect(result.charCount).toBe(input.length);
    expect(result.truncated).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('空文本', () => {
    const buffer = Buffer.from('', 'utf-8');

    const result = extractText(buffer, 'text/plain');

    expect(result.text).toBe('');
    expect(result.charCount).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  // ─── BOM 剥离 ───────────────────────────────────────────────────────────────

  it('剥离 UTF-8 BOM', () => {
    const content = 'Hello after BOM';
    // Prepend UTF-8 BOM bytes
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const body = Buffer.from(content, 'utf-8');
    const buffer = Buffer.concat([bom, body]);

    const result = extractText(buffer, 'text/plain');

    expect(result.text).toBe(content);
    expect(result.charCount).toBe(content.length);
    expect(result.truncated).toBe(false);
  });

  it('无 BOM 文本不受影响', () => {
    const input = 'No BOM here';
    const buffer = Buffer.from(input, 'utf-8');

    const result = extractText(buffer, 'text/plain');

    expect(result.text).toBe(input);
  });

  // ─── 危险 HTML 标签清除 ───────────────────────────────────────────────────────

  it('移除 <script> 标签', () => {
    const input = 'Before <script>alert("xss")</script> After';
    const buffer = Buffer.from(input, 'utf-8');

    const result = extractText(buffer, 'text/plain');

    expect(result.text).toBe('Before  After');
    expect(result.warnings).toContain('Dangerous HTML tags were removed');
  });

  it('移除 <iframe> 标签', () => {
    const input = 'Start <iframe src="evil.com"></iframe> End';
    const buffer = Buffer.from(input, 'utf-8');

    const result = extractText(buffer, 'text/plain');

    expect(result.text).toBe('Start  End');
    expect(result.warnings).toContain('Dangerous HTML tags were removed');
  });

  it('移除 <object> 标签', () => {
    const input = '<object data="malware.swf"></object>Safe text';
    const buffer = Buffer.from(input, 'utf-8');

    const result = extractText(buffer, 'text/plain');

    expect(result.text).toBe('Safe text');
  });

  it('大小写不敏感地移除危险标签', () => {
    const input = '<SCRIPT>bad</SCRIPT> <IFRAME src="x"></IFRAME>';
    const buffer = Buffer.from(input, 'utf-8');

    const result = extractText(buffer, 'text/plain');

    // Both elements (tags + content) are removed entirely
    expect(result.text).toBe(' ');
    expect(result.warnings).toContain('Dangerous HTML tags were removed');
  });

  it('无危险标签时不产生 warning', () => {
    const input = 'Just plain text, no HTML here.';
    const buffer = Buffer.from(input, 'utf-8');

    const result = extractText(buffer, 'text/plain');

    expect(result.warnings).toEqual([]);
  });

  // ─── 超大文本截断 ───────────────────────────────────────────────────────────

  it('超过 2MB 截断并设置 truncated=true', () => {
    const MAX_TEXT_CHARS = 2_097_152;
    const oversized = 'a'.repeat(MAX_TEXT_CHARS + 1000);
    const buffer = Buffer.from(oversized, 'utf-8');

    const result = extractText(buffer, 'text/plain');

    expect(result.text.length).toBe(MAX_TEXT_CHARS);
    expect(result.truncated).toBe(true);
    expect(result.warnings).toContain(`Text truncated to ${MAX_TEXT_CHARS} characters`);
  });

  it('charCount 是截断前的原始字符数', () => {
    const MAX_TEXT_CHARS = 2_097_152;
    const oversized = 'a'.repeat(MAX_TEXT_CHARS + 500);
    const buffer = Buffer.from(oversized, 'utf-8');

    const result = extractText(buffer, 'text/plain');

    expect(result.charCount).toBe(MAX_TEXT_CHARS + 500);
  });

  it('恰好等于 2MB 不截断', () => {
    const MAX_TEXT_CHARS = 2_097_152;
    const exact = 'a'.repeat(MAX_TEXT_CHARS);
    const buffer = Buffer.from(exact, 'utf-8');

    const result = extractText(buffer, 'text/plain');

    expect(result.text.length).toBe(MAX_TEXT_CHARS);
    expect(result.truncated).toBe(false);
  });

  // ─── charCount 正确 ─────────────────────────────────────────────────────────

  it('charCount 反映去除危险标签后的字符数', () => {
    const input = 'Hello <script>bad</script> World';
    const buffer = Buffer.from(input, 'utf-8');

    const result = extractText(buffer, 'text/plain');

    // After stripping: 'Hello  World' = 12 chars
    expect(result.charCount).toBe(result.text.length);
    expect(result.text).toBe('Hello  World');
  });
});
