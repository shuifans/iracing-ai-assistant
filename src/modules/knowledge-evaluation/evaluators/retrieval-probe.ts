/**
 * Retrieval probe — dimension 6 (retrievability).
 *
 * For DRAFTS (not yet indexed on disk): self-match proxy — extract significant
 * terms from the body (heading words + frequent terms), and check each is
 * reflected in the title or tags (the high-boost BM25 fields: title 3x, tags
 * 2x). If the body's key topics are absent from title/tags, a keyword search
 * won't surface this page once published → low retrievability.
 *
 * For PUBLISHED ITEMS: real probe via `searchWiki()` (BM25) — verify the item's
 * wikiPath surfaces in results for title-derived queries. (Phase 2 path; Phase
 * 1 evaluates drafts only, so this is stubbed with a clear TODO.)
 *
 * @module knowledge-evaluation/evaluators/retrieval-probe
 */

import { parseFrontMatter } from '@/modules/knowledge/front-matter';
import { DIMENSION_WEIGHT } from '../dimensions';
import { STOPWORDS } from './heuristic';
import type { DimensionScore, DraftContext, ProbeResult, EvalDimensionKey } from '../types';

const MAX_TERMS = 5;

// ---------------------------------------------------------------------------
// Body-term extraction
// ---------------------------------------------------------------------------

/**
 * Extract up to `maxN` significant terms from the body. Heading words first
 * (they describe the page's topic sections → what BM25 should match against
 * the high-boost title/tags fields). Only when there are no headings do we
 * fall back to top-frequency body words, so generic prose ('helps', 'corners')
 * is not penalized as a retrievability miss.
 */
function extractBodyTerms(body: string, maxN: number): string[] {
  const headingTerms: string[] = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^#{2,3}\s+(.*)/);
    if (m) {
      for (const w of (m[1] ?? '').toLowerCase().split(/[^a-z0-9]+/)) {
        if (w.length > 3 && !STOPWORDS.has(w)) headingTerms.push(w);
      }
    }
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of headingTerms) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
    if (out.length >= maxN) return out;
  }

  // Fallback: no headings → use top-frequency body words (rare for wiki content).
  if (out.length === 0) {
    const freq = new Map<string, number>();
    for (const w of body.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length > 3 && !STOPWORDS.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
    }
    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
    for (const t of sorted) {
      if (!seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
      if (out.length >= maxN) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

function routingHaystack(ctx: DraftContext): string[] {
  try {
    const fm = parseFrontMatter(ctx.draftContent).frontMatter;
    return [fm.title, fm.description, ...fm.tags, ...fm.aliases].map((value) =>
      value.toLowerCase(),
    );
  } catch {
    return [ctx.draft.title.toLowerCase()];
  }
}

export function runRetrievalProbe(ctx: DraftContext): ProbeResult {
  let body = '';
  try {
    body = parseFrontMatter(ctx.draftContent).body;
  } catch {
    body = ctx.draftContent;
  }

  const terms = extractBodyTerms(body, MAX_TERMS);
  if (terms.length === 0) {
    // Too short to assess — neutral score (not penalized, not rewarded).
    return { score: 50, queries: [] };
  }

  const routingFields = routingHaystack(ctx);
  const queries = terms.map((t) => {
    const hit = routingFields.some((field) => field.includes(t) || t.includes(field));
    return { query: t, hit, matchedPath: hit ? ctx.draft.suggestedPath : undefined };
  });
  const hits = queries.filter((q) => q.hit).length;
  return { score: Math.round((hits / queries.length) * 100), queries };
}

export function retrievabilityScore(ctx: DraftContext): DimensionScore {
  const probe = runRetrievalProbe(ctx);
  const dimensionKey: EvalDimensionKey = 'retrievability';
  return {
    dimensionKey,
    tier: 'probe',
    score: probe.score,
    weight: DIMENSION_WEIGHT[dimensionKey],
    rationale: probe.queries.length
      ? `${probe.queries.filter((q) => q.hit).length}/${probe.queries.length} body terms found in title/description/tags/aliases`
      : 'body too short to assess retrievability',
    detail: { queries: probe.queries },
  };
}
