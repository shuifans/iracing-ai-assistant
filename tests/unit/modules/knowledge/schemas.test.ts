import { describe, it, expect } from 'vitest';
import {
  submitUrlSchema,
  frontMatterSchema,
  editDraftSchema,
  cursorPageSchema,
  ALLOWED_KNOWLEDGE_MIMES,
} from '@/modules/knowledge/schemas';

// ─── submitUrlSchema ────────────────────────────────────────────────────────

describe('submitUrlSchema', () => {
  it('合法 HTTPS URL 通过校验', () => {
    const result = submitUrlSchema.safeParse({
      url: 'https://example.com/article',
    });
    expect(result.success).toBe(true);
  });

  it('带可选 title 通过校验', () => {
    const result = submitUrlSchema.safeParse({
      url: 'https://example.com/article',
      title: 'Test Article',
    });
    expect(result.success).toBe(true);
  });

  it('HTTP URL 被拒绝', () => {
    const result = submitUrlSchema.safeParse({
      url: 'http://example.com/article',
    });
    expect(result.success).toBe(false);
  });

  it('非 URL 字符串被拒绝', () => {
    const result = submitUrlSchema.safeParse({
      url: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('空字符串被拒绝', () => {
    const result = submitUrlSchema.safeParse({
      url: '',
    });
    expect(result.success).toBe(false);
  });

  it('title 超过 200 字符被拒绝', () => {
    const result = submitUrlSchema.safeParse({
      url: 'https://example.com/article',
      title: 'a'.repeat(201),
    });
    expect(result.success).toBe(false);
  });
});

// ─── frontMatterSchema ──────────────────────────────────────────────────────

describe('frontMatterSchema', () => {
  const validData = {
    title: 'Braking Technique Guide',
    category: 'track-technique',
    subcategory: 'braking',
    tags: ['trail-braking', 'threshold'],
  };

  it('合法完整数据通过校验', () => {
    const result = frontMatterSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it('带所有可选字段通过校验', () => {
    const result = frontMatterSchema.safeParse({
      ...validData,
      source_name: 'original-doc.txt',
      source_url: 'https://example.com/source',
      season: '2026-S1',
      updated_at: '2026-07-12',
    });
    expect(result.success).toBe(true);
  });

  it('所有合法 category 枚举值通过', () => {
    for (const cat of ['track-technique', 'car-setup', 'basics']) {
      const result = frontMatterSchema.safeParse({ ...validData, category: cat });
      expect(result.success).toBe(true);
    }
  });

  it('缺失 title 被拒绝', () => {
    const { title: _, ...withoutTitle } = validData;
    const result = frontMatterSchema.safeParse(withoutTitle);
    expect(result.success).toBe(false);
  });

  it('空 title 被拒绝', () => {
    const result = frontMatterSchema.safeParse({ ...validData, title: '' });
    expect(result.success).toBe(false);
  });

  it('非法 category 枚举被拒绝', () => {
    const result = frontMatterSchema.safeParse({
      ...validData,
      category: 'invalid-category',
    });
    expect(result.success).toBe(false);
  });

  it('tags 空数组被拒绝', () => {
    const result = frontMatterSchema.safeParse({ ...validData, tags: [] });
    expect(result.success).toBe(false);
  });

  it('tags 超过 10 个被拒绝', () => {
    const result = frontMatterSchema.safeParse({
      ...validData,
      tags: Array.from({ length: 11 }, (_, i) => `tag-${i}`),
    });
    expect(result.success).toBe(false);
  });

  it('缺失 category 被拒绝', () => {
    const { category: _, ...withoutCategory } = validData;
    const result = frontMatterSchema.safeParse(withoutCategory);
    expect(result.success).toBe(false);
  });

  it('缺失 subcategory 被拒绝', () => {
    const { subcategory: _, ...withoutSubcategory } = validData;
    const result = frontMatterSchema.safeParse(withoutSubcategory);
    expect(result.success).toBe(false);
  });

  it('缺失 tags 被拒绝', () => {
    const { tags: _, ...withoutTags } = validData;
    const result = frontMatterSchema.safeParse(withoutTags);
    expect(result.success).toBe(false);
  });
});

// ─── editDraftSchema ────────────────────────────────────────────────────────

describe('editDraftSchema', () => {
  it('合法内容通过校验', () => {
    const result = editDraftSchema.safeParse({ content: '# Article\nSome content' });
    expect(result.success).toBe(true);
  });

  it('空内容被拒绝', () => {
    const result = editDraftSchema.safeParse({ content: '' });
    expect(result.success).toBe(false);
  });

  it('缺失 content 字段被拒绝', () => {
    const result = editDraftSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ─── cursorPageSchema ───────────────────────────────────────────────────────

describe('cursorPageSchema', () => {
  it('默认值为 limit=20', () => {
    const result = cursorPageSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.cursor).toBeUndefined();
    }
  });

  it('字符串数字可自动转换', () => {
    const result = cursorPageSchema.safeParse({ limit: '50' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
    }
  });

  it('limit=1 通过校验（最小边界）', () => {
    const result = cursorPageSchema.safeParse({ limit: 1 });
    expect(result.success).toBe(true);
  });

  it('limit=100 通过校验（最大边界）', () => {
    const result = cursorPageSchema.safeParse({ limit: 100 });
    expect(result.success).toBe(true);
  });

  it('limit=0 被拒绝', () => {
    const result = cursorPageSchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it('limit=101 被拒绝', () => {
    const result = cursorPageSchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });

  it('带 cursor 通过校验', () => {
    const result = cursorPageSchema.safeParse({ limit: 10, cursor: 'abc123' });
    expect(result.success).toBe(true);
  });
});

// ─── ALLOWED_KNOWLEDGE_MIMES ────────────────────────────────────────────────

describe('ALLOWED_KNOWLEDGE_MIMES', () => {
  it('包含所有 6 种允许的 MIME 类型', () => {
    expect(ALLOWED_KNOWLEDGE_MIMES).toHaveLength(6);
    expect(ALLOWED_KNOWLEDGE_MIMES).toContain('text/plain');
    expect(ALLOWED_KNOWLEDGE_MIMES).toContain('text/markdown');
    expect(ALLOWED_KNOWLEDGE_MIMES).toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(ALLOWED_KNOWLEDGE_MIMES).toContain('application/pdf');
    expect(ALLOWED_KNOWLEDGE_MIMES).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(ALLOWED_KNOWLEDGE_MIMES).toContain('application/vnd.ms-excel');
  });
});
