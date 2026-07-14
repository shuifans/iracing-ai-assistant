/**
 * Knowledge-evaluation module types — view types for the evaluation pipeline.
 *
 * @module knowledge-evaluation/types
 */

import type {
  EvaluationTier,
  EvaluationStatus,
  DimensionTier,
  EvalDimensionKey,
} from '@/config/constants';
import type { KnowledgeDraft, KnowledgeSource } from '@/db/schema/knowledge';
import type { IndexEntry } from '@/modules/knowledge/wiki-index';

export type { EvalDimensionKey, EvaluationTier, EvaluationStatus, DimensionTier };

// ---------------------------------------------------------------------------
// Scoring primitives
// ---------------------------------------------------------------------------

export interface DimensionScore {
  dimensionKey: EvalDimensionKey;
  tier: DimensionTier;
  score: number; // 0-100
  weight: number; // 0-100 aggregate weight
  rationale?: string;
  /** Field errors / overlap candidates / probe queries+hits (stored as JSON). */
  detail?: Record<string, unknown>;
}

export interface ProbeQueryResult {
  query: string;
  hit: boolean;
  matchedPath?: string;
}

export interface ProbeResult {
  score: number; // 0-100
  queries: ProbeQueryResult[];
}

// ---------------------------------------------------------------------------
// Public service results
// ---------------------------------------------------------------------------

export interface EvaluationResult {
  evaluationId: string;
  draftId: string;
  tier: EvaluationTier;
  overallScore: number;
  status: EvaluationStatus;
  deepEval: boolean;
  dimensions: DimensionScore[];
  errorMessage?: string | null;
  evaluatedAt: string;
}

export interface FeedbackPayload {
  dimensionRatings?: Record<string, number>; // dimensionKey -> 0-100
  comments?: string;
  improvementInstructions?: Record<string, unknown>;
}

export interface ReCleanResult {
  jobId: string;
  draftId: string;
  parentDraftId: string;
  version: number;
  instructionsJson: string;
}

// ---------------------------------------------------------------------------
// Evaluator input context
// ---------------------------------------------------------------------------

export interface DraftContext {
  draft: KnowledgeDraft;
  source: KnowledgeSource;
  /** Cleaned markdown content (front matter + body) read from the draft file. */
  draftContent: string;
  /** Raw extracted text from the source, if available. */
  extractedText: string | null;
  /** Existing published wiki entries (for dedup + retrieval probe). */
  indexEntries: IndexEntry[];
}
