import { describe, it, expect } from 'vitest';
import {
  parseFrontMatter,
  validateFrontMatter,
  assertTrustedSourceMetadata,
  generateWikiPath,
} from '@/modules/knowledge/front-matter';
import { AppError } from '@/lib/errors';

// ---------------------------------------------------------------------------
// parseFrontMatter
// ---------------------------------------------------------------------------

describe('parseFrontMatter', () => {
  const validDoc = `---
id: source-1
title: Late Braking Guide
description: "Braking guide: thresholds, technique, and limitations."
category: driving-technique
subcategory: braking
tags: [braking, late-braking, iracing]
aliases: [Late braking, Threshold braking]
source_id: source-1
source_sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
source_name: iRacing Blog
season: 2024S3
---

# Late Braking Guide

This is the body content with some **markdown**.
`;

  it('合法完整 Front Matter + body → 正确解析', () => {
    const result = parseFrontMatter(validDoc);
    expect(result.frontMatter.title).toBe('Late Braking Guide');
    expect(result.frontMatter.category).toBe('driving-technique');
    expect(result.frontMatter.subcategory).toBe('braking');
    expect(result.frontMatter.tags).toEqual(['braking', 'late-braking', 'iracing']);
    expect(result.frontMatter.aliases).toEqual(['Late braking', 'Threshold braking']);
    expect(result.frontMatter.description).toContain('thresholds');
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
category: driving-technique
---

body`;
    expect(() => parseFrontMatter(bad)).toThrow(AppError);
  });

  it('Front Matter 有额外未知字段 → 忽略多余字段', () => {
    const doc = `---
id: source-extra
title: Extra Fields
category: car-setup
description: Extra field parsing test.
subcategory: setup-fundamentals
tags: [setup]
aliases: []
source_id: source-extra
source_sha256: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
extra_field: should be ignored
another: also ignored
---

body`;
    const result = parseFrontMatter(doc);
    expect(result.frontMatter.title).toBe('Extra Fields');
    expect(
      (result.frontMatter as unknown as Record<string, unknown>)['extra_field'],
    ).toBeUndefined();
    expect((result.frontMatter as unknown as Record<string, unknown>)['another']).toBeUndefined();
  });

  it('body 中包含 --- 不影响解析', () => {
    const doc = `---
id: source-separator
title: Separator Test
description: Body separator parsing test.
category: getting-started
subcategory: first-race
tags: [test]
aliases: []
source_id: source-separator
source_sha256: cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
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
id: source-no-newline
title: No Trailing Newline
description: Closing delimiter parsing test.
category: hardware-and-software
subcategory: wheels-and-pedals
tags: [hardware]
aliases: []
source_id: source-no-newline
source_sha256: dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
---
Body starts here.`;
    const result = parseFrontMatter(doc);
    expect(result.frontMatter.title).toBe('No Trailing Newline');
    expect(result.body).toContain('Body starts here.');
  });
});

describe('assertTrustedSourceMetadata', () => {
  const metadata = {
    id: 'source-1',
    title: 'Guide',
    description: 'Description',
    category: 'driving-technique' as const,
    subcategory: 'braking',
    tags: ['braking'],
    aliases: [],
    source_id: 'source-1',
    source_sha256: 'a'.repeat(64),
  };

  it('accepts metadata copied from the immutable source', () => {
    expect(() =>
      assertTrustedSourceMetadata(metadata, { id: 'source-1', sha256: 'a'.repeat(64) }),
    ).not.toThrow();
  });

  it('rejects an edited source id or hash', () => {
    expect(() =>
      assertTrustedSourceMetadata(
        { ...metadata, source_sha256: 'b'.repeat(64) },
        { id: 'source-1', sha256: 'a'.repeat(64) },
      ),
    ).toThrow(AppError);
  });
});

// ---------------------------------------------------------------------------
// validateFrontMatter
// ---------------------------------------------------------------------------

describe('validateFrontMatter', () => {
  const validData = {
    id: 'source-1',
    title: 'Valid Title',
    description: 'Valid routing description.',
    category: 'driving-technique',
    subcategory: 'braking',
    tags: ['tag1'],
    aliases: [],
    source_id: 'source-1',
    source_sha256: 'a'.repeat(64),
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
  it('正常标题 → driving-technique/braking/late-braking-guide.md', () => {
    const fm = {
      title: 'Late Braking Guide',
      category: 'driving-technique',
      subcategory: 'braking',
      tags: ['braking'],
    };
    expect(generateWikiPath(fm)).toBe('driving-technique/braking/late-braking-guide.md');
  });

  it('中文标题处理', () => {
    const fm = {
      title: '刹车技巧指南',
      category: 'driving-technique',
      subcategory: 'braking',
      tags: ['braking'],
    };
    const path = generateWikiPath(fm);
    expect(path).toMatch(/^driving-technique\/braking\/.+\.md$/);
    // Should not contain spaces or special chars
    expect(path).not.toMatch(/\s/);
  });

  it('特殊字符去除', () => {
    const fm = {
      title: 'Setup Guide: Part 1 (Draft)',
      category: 'car-setup',
      subcategory: 'setup-fundamentals',
      tags: ['setup'],
    };
    const path = generateWikiPath(fm);
    expect(path).toBe('car-setup/setup-fundamentals/setup-guide-part-1-draft.md');
  });

  it('连续短横线合并', () => {
    const fm = {
      title: 'A --- B',
      category: 'hardware-and-software',
      subcategory: 'wheels-and-pedals',
      tags: ['test'],
    };
    const path = generateWikiPath(fm);
    expect(path).not.toContain('--');
  });
});
