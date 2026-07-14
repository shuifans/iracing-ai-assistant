/**
 * Dimension registry + aggregate scoring for knowledge evaluation.
 *
 * Defines the 9 evaluation dimensions (heuristic 1-5, probe 6, LLM 7-9),
 * their weights (sum = 100), and the overall-score / tier computation.
 *
 * @module knowledge-evaluation/dimensions
 */

import type { EvaluationTier, DimensionTier, EvalDimensionKey } from '@/config/constants';

export interface DimensionSpec {
  key: EvalDimensionKey;
  tier: DimensionTier;
  weight: number;
}

export const DIMENSIONS: readonly DimensionSpec[] = [
  { key: 'front_matter_validity', tier: 'heuristic', weight: 15 },
  { key: 'content_length', tier: 'heuristic', weight: 10 },
  { key: 'tag_category_sanity', tier: 'heuristic', weight: 10 },
  { key: 'dedup_overlap', tier: 'heuristic', weight: 15 },
  { key: 'freshness', tier: 'heuristic', weight: 5 },
  { key: 'retrievability', tier: 'probe', weight: 20 },
  { key: 'accuracy', tier: 'llm', weight: 10 },
  { key: 'completeness', tier: 'llm', weight: 10 },
  { key: 'clarity', tier: 'llm', weight: 5 },
] as const;

export const DIMENSION_WEIGHT: Record<EvalDimensionKey, number> = DIMENSIONS.reduce(
  (acc, d) => {
    acc[d.key] = d.weight;
    return acc;
  },
  {} as Record<EvalDimensionKey, number>,
);

/**
 * Overall score normalized to 0-100 over the dimensions actually present.
 * (Heuristic + probe always run; LLM dims only on deep eval.) This keeps
 * Phase-1 (no-LLM) scores comparable to Phase-2 (with-LLM) scores.
 */
export function computeOverallScore(
  scores: { dimensionKey: EvalDimensionKey; score: number }[],
): number {
  let weighted = 0;
  let weightSum = 0;
  for (const s of scores) {
    const w = DIMENSION_WEIGHT[s.dimensionKey] ?? 0;
    weighted += s.score * w;
    weightSum += w;
  }
  if (weightSum === 0) return 0;
  return Math.round(weighted / weightSum);
}

/** A≥85 / B70-84 / C60-69 / D<60. */
export function tierForScore(score: number): EvaluationTier {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}
