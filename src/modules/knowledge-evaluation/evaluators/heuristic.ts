/**
 * Heuristic evaluators — dimensions 1-5 (deterministic, no LLM, zero token cost).
 *
 *   1. front_matter_validity — parseFrontMatter + validateFrontMatter
 *   2. content_length        — body char count vs MAX_CONTENT_CHARS (5000)
 *   3. tag_category_sanity   — KNOWLEDGE_CATEGORIES + tag count
 *   4. dedup_overlap         — 3-shingle Jaccard vs existing IndexEntries
 *   5. freshness             — frontMatter.updated_at / source.createdAt age
 *
 * @module knowledge-evaluation/evaluators/heuristic
 */

import { parseFrontMatter } from '@/modules/knowledge/front-matter';
import { KNOWLEDGE_CATEGORIES } from '@/config/constants';
import { isAppError } from '@/lib/errors';
import { DIMENSION_WEIGHT } from '../dimensions';
import type { DimensionScore, DraftContext, EvalDimensionKey } from '../types';

const MAX_CONTENT_CHARS = 5000;
const MIN_BODY_CHARS = 200;
const FRESH_STALE_DAYS = 730;

/** Minimal English stopword set for shingle / term extraction. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'has', 'have', 'this', 'that', 'with',
  'from', 'they', 'will', 'would', 'there', 'their', 'what', 'about', 'which',
  'when', 'your', 'into', 'than', 'them', 'then', 'also', 'more', 'such',
  'were', 'been', 'being', 'some', 'these', 'those', 'each', 'very', 'over',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function score(
  key: EvalDimensionKey,
  s: number,
  rationale: string,
  detail?: Record<string, unknown>,
): DimensionScore {
  return {
    dimensionKey: key,
    tier: 'heuristic',
    score: clamp(s),
    weight: DIMENSION_WEIGHT[key],
    rationale,
    detail,
  };
}

/** 3-character shingles of a normalized string (ASCII alnum + CJK). */
function shingles(text: string): Set<string> {
  const norm = text.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '');
  const out = new Set<string>();
  if (norm.length === 0) return out;
  if (norm.length < 3) {
    out.add(norm);
    return out;
  }
  for (let i = 0; i + 3 <= norm.length; i++) out.add(norm.slice(i, i + 3));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

const CATEGORIES_MAP = KNOWLEDGE_CATEGORIES as unknown as Record<string, readonly string[]>;

// ---------------------------------------------------------------------------
// Dimension checks
// ---------------------------------------------------------------------------

/** 1. Front Matter validity — 100 if parse+validate succeeds, 0 on DRAFT_INVALID. */
function frontMatterValidity(ctx: DraftContext): DimensionScore {
  try {
    parseFrontMatter(ctx.draftContent);
    return score('front_matter_validity', 100, 'Front Matter valid');
  } catch (err) {
    if (isAppError(err)) {
      return score('front_matter_validity', 0, err.message, {
        fields: err.fields ?? {},
      });
    }
    return score('front_matter_validity', 0, 'Front Matter parse failed', {
      error: String(err),
    });
  }
}

/** 2. Content length — 200–5000 body chars = 100; <200 = 20; >5000 = 40. */
function contentLength(ctx: DraftContext): DimensionScore {
  let bodyLen = 0;
  let parsed = true;
  try {
    bodyLen = parseFrontMatter(ctx.draftContent).body.length;
  } catch {
    parsed = false;
    bodyLen = ctx.draftContent.length;
  }
  let s: number;
  if (!parsed) s = 20;
  else if (bodyLen < MIN_BODY_CHARS) s = 20;
  else if (bodyLen <= MAX_CONTENT_CHARS) s = 100;
  else s = 40;
  return score(
    'content_length',
    s,
    `body ${bodyLen} chars${parsed ? '' : ' (unparsed)'}`,
    { bodyLength: bodyLen, parsed },
  );
}

/** 3. Tag / category sanity — category & subcategory must be in the taxonomy. */
function tagCategorySanity(ctx: DraftContext): DimensionScore {
  let fm: { category: string; subcategory: string; tags: string[] };
  try {
    fm = parseFrontMatter(ctx.draftContent).frontMatter;
  } catch {
    return score('tag_category_sanity', 0, 'Front Matter invalid', {});
  }
  const issues: string[] = [];
  const catOk = Object.prototype.hasOwnProperty.call(CATEGORIES_MAP, fm.category);
  if (!catOk) issues.push(`invalid category '${fm.category}'`);
  const subList = CATEGORIES_MAP[fm.category];
  const subOk = catOk && !!subList && subList.includes(fm.subcategory);
  if (catOk && !subOk) {
    issues.push(`invalid subcategory '${fm.subcategory}' for ${fm.category}`);
  }
  const tagCount = Array.isArray(fm.tags) ? fm.tags.length : 0;
  if (!Array.isArray(fm.tags) || tagCount < 1) issues.push('tags missing/empty');
  else if (tagCount > 10) issues.push(`too many tags (${tagCount})`);

  const penalty = Math.min(100, issues.length * 30);
  return score(
    'tag_category_sanity',
    100 - penalty,
    issues.length ? issues.join('; ') : 'category/subcategory/tags OK',
    { category: fm.category, subcategory: fm.subcategory, tagCount, issues },
  );
}

/** 4. Dedup overlap — 3-shingle Jaccard of (title+tags) vs each IndexEntry. */
function dedupOverlap(ctx: DraftContext): DimensionScore {
  let fm: { title: string; tags: string[] };
  try {
    fm = parseFrontMatter(ctx.draftContent).frontMatter;
  } catch {
    return score('dedup_overlap', 50, 'Front Matter invalid — dedup skipped', {});
  }
  const draftShingles = shingles(`${fm.title} ${Array.isArray(fm.tags) ? fm.tags.join(' ') : ''}`);
  const ranked = ctx.indexEntries
    .map((e) => ({
      wikiPath: e.wikiPath,
      title: e.title,
      overlap: jaccard(draftShingles, shingles(`${e.title} ${e.tags.join(' ')} ${e.subcategory}`)),
    }))
    .sort((a, b) => b.overlap - a.overlap);
  const maxOverlap = ranked[0]?.overlap ?? 0;
  const s = Math.round(100 * (1 - Math.min(1, maxOverlap / 0.6)));
  const candidates = ranked
    .filter((c) => c.overlap > 0)
    .slice(0, 3)
    .map((c) => ({ wikiPath: c.wikiPath, title: c.title, overlap: Math.round(c.overlap * 1000) / 1000 }));
  const dupLikely = maxOverlap >= 0.6;
  return score(
    'dedup_overlap',
    s,
    dupLikely
      ? `likely duplicate (overlap ${maxOverlap.toFixed(2)})`
      : `max overlap ${maxOverlap.toFixed(2)}`,
    { maxOverlap: Math.round(maxOverlap * 1000) / 1000, candidates },
  );
}

/** 5. Freshness — age of updated_at / source.createdAt; >730 days = 40. */
function freshness(ctx: DraftContext): DimensionScore {
  let basis = ctx.source.createdAt;
  try {
    const fm = parseFrontMatter(ctx.draftContent).frontMatter;
    if (fm.updated_at) basis = fm.updated_at;
  } catch {
    // fall back to source.createdAt
  }
  const ts = Date.parse(basis);
  if (!Number.isFinite(ts)) {
    return score('freshness', 60, 'no parseable timestamp', { basis });
  }
  const ageDays = Math.floor((Date.now() - ts) / 86_400_000);
  const s = ageDays > FRESH_STALE_DAYS ? 40 : 100;
  return score('freshness', s, `${ageDays} days old`, { ageDays, basis });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function runHeuristicChecks(ctx: DraftContext): DimensionScore[] {
  return [
    frontMatterValidity(ctx),
    contentLength(ctx),
    tagCategorySanity(ctx),
    dedupOverlap(ctx),
    freshness(ctx),
  ];
}

// Exported for retrieval-probe / tests
export { STOPWORDS, shingles, jaccard };
