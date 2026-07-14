import { describe, it, expect } from 'vitest';
import {
  runHeuristicChecks,
  shingles,
  jaccard,
} from '@/modules/knowledge-evaluation/evaluators/heuristic';
import type { DraftContext } from '@/modules/knowledge-evaluation/types';
import type { KnowledgeDraft, KnowledgeSource } from '@/db/schema/knowledge';
import type { IndexEntry } from '@/modules/knowledge/wiki-index';

function makeCtx(
  draftContent: string,
  opts: { createdAt?: string; indexEntries?: IndexEntry[] } = {},
): DraftContext {
  return {
    draft: {
      id: 'd1',
      jobId: 'j1',
      suggestedPath: 'driving-technique/braking/guide.md',
      title: 'Guide',
      version: 1,
      parentDraftId: null,
    } as unknown as KnowledgeDraft,
    source: {
      id: 's1',
      createdAt: opts.createdAt ?? '2026-07-01T00:00:00.000Z',
    } as unknown as KnowledgeSource,
    draftContent,
    extractedText: null,
    indexEntries: opts.indexEntries ?? [],
  };
}

function validFM(body: string): string {
  return `---
id: s1
title: Trail Braking Guide
description: Trail braking technique and application.
category: driving-technique
subcategory: braking
tags: [braking, trail, technique]
aliases: [trail brake]
source_id: s1
source_sha256: ${'a'.repeat(64)}
---

${body}`;
}

function findDim<T extends { dimensionKey: string }>(dims: T[], key: string): T {
  const d = dims.find((x) => x.dimensionKey === key);
  if (!d) throw new Error(`dimension ${key} not found`);
  return d;
}

describe('heuristic evaluators', () => {
  // ─── front_matter_validity ───────────────────────────────────────────────

  describe('front_matter_validity', () => {
    it('100 when Front Matter valid', () => {
      const dims = runHeuristicChecks(makeCtx(validFM('body content here')));
      expect(findDim(dims, 'front_matter_validity').score).toBe(100);
    });

    it('0 with field errors when FM missing', () => {
      const dims = runHeuristicChecks(makeCtx('no front matter here'));
      const d = findDim(dims, 'front_matter_validity');
      expect(d.score).toBe(0);
      expect(d.detail?.fields).toBeDefined();
    });
  });

  // ─── content_length ──────────────────────────────────────────────────────

  describe('content_length', () => {
    it('100 for 200-12000 body chars', () => {
      const dims = runHeuristicChecks(makeCtx(validFM('x'.repeat(300))));
      expect(findDim(dims, 'content_length').score).toBe(100);
    });

    it('20 for body < 200 chars', () => {
      const dims = runHeuristicChecks(makeCtx(validFM('short')));
      expect(findDim(dims, 'content_length').score).toBe(20);
    });

    it('40 for body > 12000 chars', () => {
      const dims = runHeuristicChecks(makeCtx(validFM('x'.repeat(12001))));
      expect(findDim(dims, 'content_length').score).toBe(40);
    });
  });

  // ─── tag_category_sanity ─────────────────────────────────────────────────

  describe('tag_category_sanity', () => {
    it('100 for valid category/subcategory/tags', () => {
      const dims = runHeuristicChecks(makeCtx(validFM('body')));
      expect(findDim(dims, 'tag_category_sanity').score).toBe(100);
    });

    it('penalizes invalid category', () => {
      const content = `---
title: X
category: bogus
subcategory: braking
tags: [a]
---

body`;
      const dims = runHeuristicChecks(makeCtx(content));
      expect(findDim(dims, 'tag_category_sanity').score).toBeLessThan(100);
    });

    it('penalizes invalid subcategory for known category', () => {
      const content = `---
title: X
category: driving-technique
subcategory: bogus
tags: [a]
---

body`;
      const dims = runHeuristicChecks(makeCtx(content));
      expect(findDim(dims, 'tag_category_sanity').score).toBeLessThan(100);
    });
  });

  // ─── dedup_overlap ───────────────────────────────────────────────────────

  describe('dedup_overlap', () => {
    it('high score when no similar entry', () => {
      const entries: IndexEntry[] = [
        {
          title: 'Hardware Buying Advice',
          description: 'Wheel and pedal buying advice',
          category: 'getting-started',
          subcategory: 'hardware',
          wikiPath: 'basics/hardware/hardware.md',
          tags: ['wheel', 'pedals'],
          aliases: [],
        },
      ];
      const dims = runHeuristicChecks(makeCtx(validFM('body content'), { indexEntries: entries }));
      expect(findDim(dims, 'dedup_overlap').score).toBeGreaterThanOrEqual(80);
    });

    it('low score when near-duplicate exists', () => {
      const entries: IndexEntry[] = [
        {
          title: 'Trail Braking Guide',
          description: 'How to use trail braking',
          category: 'driving-technique',
          subcategory: 'braking',
          wikiPath: 'driving-technique/braking/trail-braking-guide.md',
          tags: ['braking', 'trail', 'technique'],
          aliases: [],
        },
      ];
      const dims = runHeuristicChecks(makeCtx(validFM('body content'), { indexEntries: entries }));
      const d = findDim(dims, 'dedup_overlap');
      expect(d.score).toBeLessThanOrEqual(20);
      expect(d.detail?.candidates).toBeDefined();
    });
  });

  // ─── freshness ──────────────────────────────────────────────────────────

  describe('freshness', () => {
    it('100 when recent', () => {
      const dims = runHeuristicChecks(
        makeCtx(validFM('body'), { createdAt: '2026-07-01T00:00:00.000Z' }),
      );
      expect(findDim(dims, 'freshness').score).toBe(100);
    });

    it('40 when older than 730 days', () => {
      const dims = runHeuristicChecks(
        makeCtx(validFM('body'), { createdAt: '2020-01-01T00:00:00.000Z' }),
      );
      expect(findDim(dims, 'freshness').score).toBe(40);
    });

    it('uses frontMatter.updated_at when present', () => {
      const content = `---
id: s1
title: X
description: Old guide
category: driving-technique
subcategory: braking
tags: [a]
aliases: []
source_id: s1
source_sha256: ${'a'.repeat(64)}
updated_at: 2020-01-01
---

body`;
      const dims = runHeuristicChecks(makeCtx(content, { createdAt: '2026-07-01T00:00:00.000Z' }));
      expect(findDim(dims, 'freshness').score).toBe(40);
    });

    it('penalizes an explicitly expired note', () => {
      const content = validFM('body').replace(
        'source_sha256:',
        'expires_at: 2020-01-01\nsource_sha256:',
      );
      const dims = runHeuristicChecks(makeCtx(content));
      expect(findDim(dims, 'freshness').score).toBe(20);
      expect(findDim(dims, 'freshness').rationale).toContain('expired');
    });
  });

  // ─── weights ─────────────────────────────────────────────────────────────

  it('all heuristic dims carry the configured weight', () => {
    const dims = runHeuristicChecks(makeCtx(validFM('body')));
    const weights = Object.fromEntries(dims.map((d) => [d.dimensionKey, d.weight]));
    expect(weights).toEqual({
      front_matter_validity: 15,
      content_length: 10,
      tag_category_sanity: 10,
      dedup_overlap: 15,
      freshness: 5,
    });
  });

  // ─── shingles / jaccard primitives ───────────────────────────────────────

  describe('shingles + jaccard', () => {
    it('jaccard identical = 1, disjoint ≈ 0', () => {
      const a = shingles('trail braking');
      expect(jaccard(a, shingles('trail braking'))).toBe(1);
      expect(jaccard(a, shingles('zzzzz qqqqq'))).toBeLessThan(0.05);
    });
  });
});
