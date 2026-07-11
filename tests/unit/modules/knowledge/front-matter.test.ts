import { describe, it, expect } from 'vitest';
import {
  parseFrontMatter,
  validateFrontMatter,
  generateWikiPath,
} from '@/modules/knowledge/front-matter';
import { AppError } from '@/lib/errors';

// ---------------------------------------------------------------------------
// parseFrontMatter
// ---------------------------------------------------------------------------

describe('parseFrontMatter', () => {
  const validDoc = `---
title: Late Braking Guide
category: track-technique
subcategory: braking
tags: [braking, late-braking, iracing]
source_name: iRacing Blog
season: 2024S3
---

# Late Braking Guide

This is the body content with some **markdown**.
`;

  it('合法完整 Front Matter + body → 正确解析', () => {
    const result = parseFrontMatter(validDoc);
    expect(result.frontMatter.title).toBe('Late Braking Guide');
    expect(result.frontMatter.category).toBe('track-technique');
    expect(result.frontMatter.subcategory).toBe('braking');
    expect(result.frontMatter.tags).toEqual(['braking', 'late-braking', 'iracing']);
    expect(result.frontMatter.source_name).toBe('iRacing Blog');
    expect(result.frontMatter.season).toBe('2024S3');
    expect(result.body).toContain('# Late Braking Guide');
    expect(result.body).toContain('**markdown**');
  });

  it('无 Front Matter（纯 Markdown）→ 抛出错误', () => {
    const plain = '# Just a heading\n\nSome text here.';
    expect(() => parseFrontMatter(plain)).toThrow(AppError);
  });

  it('Front Matter 格式错误（缺少开头 ---）→ 抛出错误', () => {
    const bad = `title: No Delimiter
category: track-technique
---

body`;
    expect(() => parseFrontMatter(bad)).toThrow(AppError);
  });

  it('Front Matter 有额外未知字段 → 忽略多余字段', () => {
    const doc = `---
title: Extra Fields
category: car-setup
subcategory: theory
tags: [setup]
extra_field: should be ignored
another: also ignored
---

body`;
    const result = parseFrontMatter(doc);
    expect(result.frontMatter.title).toBe('Extra Fields');
    expect((result.frontMatter as Record<string, unknown>)['extra_field']).toBeUndefined();
    expect((result.frontMatter as Record<string, unknown>)['another']).toBeUndefined();
  });

  it('body 中包含 --- 不影响解析', () => {
    const doc = `---
title: Separator Test
category: basics
subcategory: getting-started
tags: [test]
---

Some body text.

---

More body after a horizontal rule.
`;
    const result = parseFrontMatter(doc);
    expect(result.frontMatter.title).toBe('Separator Test');
    expect(result.body).toContain('---');
    expect(result.body).toContain('More body after a horizontal rule.');
  });

  it('Front Matter 末尾 --- 后无换行也能解析', () => {
    const doc = `---
title: No Trailing Newline
category: basics
subcategory: hardware
tags: [hardware]
---
Body starts here.`;
    const result = parseFrontMatter(doc);
    expect(result.frontMatter.title).toBe('No Trailing Newline');
    expect(result.body).toContain('Body starts here.');
  });
});

// ---------------------------------------------------------------------------
// validateFrontMatter
// ---------------------------------------------------------------------------

describe('validateFrontMatter', () => {
  const validData = {
    title: 'Valid Title',
    category: 'track-technique',
    subcategory: 'braking',
    tags: ['tag1'],
  };

  it('完整合法数据 → 通过', () => {
    const result = validateFrontMatter(validData);
    expect(result.title).toBe('Valid Title');
  });

  it('缺失 title → 校验错误', () => {
    const data = { ...validData, title: undefined };
    expect(() => validateFrontMatter(data)).toThrow(AppError);
  });

  it('非法 category 枚举值 → 校验错误', () => {
    const data = { ...validData, category: 'nonexistent-category' };
    expect(() => validateFrontMatter(data)).toThrow(AppError);
  });

  it('tags 为空数组 → 校验错误', () => {
    const data = { ...validData, tags: [] };
    expect(() => validateFrontMatter(data)).toThrow(AppError);
  });

  it('title 超长 → 校验错误', () => {
    const data = { ...validData, title: 'x'.repeat(201) };
    expect(() => validateFrontMatter(data)).toThrow(AppError);
  });
});

// ---------------------------------------------------------------------------
// generateWikiPath
// ---------------------------------------------------------------------------

describe('generateWikiPath', () => {
  it('正常标题 → track-technique/braking/late-braking-guide.md', () => {
    const fm = {
      title: 'Late Braking Guide',
      category: 'track-technique',
      subcategory: 'braking',
      tags: ['braking'],
    };
    expect(generateWikiPath(fm)).toBe('track-technique/braking/late-braking-guide.md');
  });

  it('中文标题处理', () => {
    const fm = {
      title: '刹车技巧指南',
      category: 'track-technique',
      subcategory: 'braking',
      tags: ['braking'],
    };
    const path = generateWikiPath(fm);
    expect(path).toMatch(/^track-technique\/braking\/.+\.md$/);
    // Should not contain spaces or special chars
    expect(path).not.toMatch(/\s/);
  });

  it('特殊字符去除', () => {
    const fm = {
      title: 'Setup Guide: Part 1 (Draft)',
      category: 'car-setup',
      subcategory: 'theory',
      tags: ['setup'],
    };
    const path = generateWikiPath(fm);
    expect(path).toBe('car-setup/theory/setup-guide-part-1-draft.md');
  });

  it('连续短横线合并', () => {
    const fm = {
      title: 'A --- B',
      category: 'basics',
      subcategory: 'hardware',
      tags: ['test'],
    };
    const path = generateWikiPath(fm);
    expect(path).not.toContain('--');
  });
});
