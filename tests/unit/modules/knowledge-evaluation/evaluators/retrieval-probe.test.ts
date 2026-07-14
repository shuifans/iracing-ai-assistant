import { describe, it, expect } from 'vitest';
import {
  runRetrievalProbe,
  retrievabilityScore,
} from '@/modules/knowledge-evaluation/evaluators/retrieval-probe';
import type { DraftContext } from '@/modules/knowledge-evaluation/types';
import type { KnowledgeDraft, KnowledgeSource } from '@/db/schema/knowledge';

function makeCtx(draftContent: string): DraftContext {
  return {
    draft: {
      id: 'd1',
      jobId: 'j1',
      suggestedPath: 'track-technique/braking/guide.md',
      title: 'Guide',
      version: 1,
      parentDraftId: null,
    } as unknown as KnowledgeDraft,
    source: { id: 's1', createdAt: '2026-07-01T00:00:00.000Z' } as unknown as KnowledgeSource,
    draftContent,
    extractedText: null,
    indexEntries: [],
  };
}

describe('retrieval-probe', () => {
  it('scores well when body terms appear in title/tags', () => {
    const content = `---
title: Trail Braking Guide
category: track-technique
subcategory: braking
tags: [braking, trail, technique]
---

## Braking Technique
Trail braking helps with braking into corners.`;
    const probe = runRetrievalProbe(makeCtx(content));
    expect(probe.queries.length).toBeGreaterThan(0);
    expect(probe.score).toBeGreaterThanOrEqual(50);
  });

  it('flags body terms absent from title/tags as misses', () => {
    const content = `---
title: Guide
category: track-technique
subcategory: braking
tags: [misc]
---

## Braking Technique
Threshold braking and trail braking methods discussed extensively.`;
    const probe = runRetrievalProbe(makeCtx(content));
    // 'braking' is a key body term but absent from title 'Guide' / tags ['misc']
    expect(probe.queries.some((q) => q.query === 'braking' && !q.hit)).toBe(true);
  });

  it('neutral 50 when body too short to assess', () => {
    const content = `---
title: X
category: track-technique
subcategory: braking
tags: [a]
---

ok`;
    const probe = runRetrievalProbe(makeCtx(content));
    expect(probe.score).toBe(50);
    expect(probe.queries).toEqual([]);
  });

  it('retrievabilityScore returns a probe-tier dimension with weight 20', () => {
    const content = `---
title: Trail Braking
category: track-technique
subcategory: braking
tags: [braking]
---

## Braking
Trail braking technique.`;
    const d = retrievabilityScore(makeCtx(content));
    expect(d.dimensionKey).toBe('retrievability');
    expect(d.tier).toBe('probe');
    expect(d.weight).toBe(20);
  });
});
