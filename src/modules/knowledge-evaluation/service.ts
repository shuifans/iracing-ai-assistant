/**
 * Knowledge-evaluation service — orchestrates heuristic + probe (+ Phase 2 LLM)
 * evaluation, persists scores, and implements the manual feedback → re-clean loop.
 *
 * Spec:
 *   - evaluateDraft(draftId, {deep}) → run heuristic (1-5) + probe (6), persist,
 *     return scorecard. Auto-run from the worker after createDraft (deep=false).
 *   - submitFeedback(draftId, payload, authorId) → persist reviewer feedback.
 *   - reCleanWithFeedback(draftId, userId) → enqueue a re-clean job carrying the
 *     accumulated feedback as instructions; mark feedback applied. No auto loop.
 *   - getEvaluation / listEvaluations / getFeedback / getDraftVersions — read paths.
 *
 * @module knowledge-evaluation/service
 */

import * as fs from 'fs';
import * as path from 'path';
import { AppError } from '@/lib/errors';
import { utcNow } from '@/lib/datetime';
import { env } from '@/config/env';
import * as knowledgeRepo from '@/modules/knowledge/repository';
import * as jobsRepo from '@/modules/jobs/repository';
import * as jobsService from '@/modules/jobs/service';
import { recordAudit } from '@/modules/audit/service';
import { collectIndexEntries } from '@/modules/knowledge/wiki-index';
import * as evalRepo from './repository';
import { runHeuristicChecks } from './evaluators/heuristic';
import { retrievabilityScore } from './evaluators/retrieval-probe';
import { computeOverallScore, tierForScore } from './dimensions';
import type {
  DimensionScore,
  EvaluationResult,
  FeedbackPayload,
  ReCleanResult,
  DraftContext,
} from './types';
import type { EvaluationStatus, EvalDimensionKey } from '@/config/constants';

// ---------------------------------------------------------------------------
// evaluateDraft
// ---------------------------------------------------------------------------

/**
 * Run (or re-run) evaluation for a draft. Heuristic (1-5) + retrieval probe (6)
 * always run; LLM dims (7-9) run only when deep=true (Phase 2). Eval-internal
 * failures set status='failed' and return a result (never throw) — the worker
 * auto-eval is non-fatal. NOT_FOUND is thrown (real precondition error).
 */
export async function evaluateDraft(
  draftId: string,
  opts: { deep?: boolean; evaluatedBy?: string | null } = {},
): Promise<EvaluationResult> {
  const deep = opts.deep ?? false;
  const draft = knowledgeRepo.getDraft(draftId);
  if (!draft) throw new AppError('NOT_FOUND', `Draft ${draftId} not found`);

  const job = jobsRepo.getJob(draft.jobId);
  if (!job) throw new AppError('NOT_FOUND', `Job for draft ${draftId} not found`);
  const source = knowledgeRepo.getSource(job.sourceId);
  if (!source) throw new AppError('NOT_FOUND', `Source for draft ${draftId} not found`);

  // Read cleaned draft content from disk (same path math as getDraftWithDiff)
  const draftFilePath = path.join(env.DATA_ROOT as string, 'drafts', draft.draftRelativePath);
  let draftContent = '';
  if (fs.existsSync(draftFilePath)) draftContent = fs.readFileSync(draftFilePath, 'utf-8');

  const indexEntries = collectIndexEntries(env.WIKI_ROOT as string);
  const ctx: DraftContext = { draft, source, draftContent, extractedText: null, indexEntries };

  // Get-or-create the 1:1 evaluation row; reset to pending for a re-run.
  let evaluation = evalRepo.getEvaluationByDraftId(draftId);
  if (evaluation) {
    evalRepo.updateEvaluation(evaluation.id, {
      status: 'pending',
      deepEval: deep,
      errorMessage: null,
      evaluatedBy: opts.evaluatedBy ?? null,
    });
  } else {
    evaluation = evalRepo.createEvaluation({
      draftId,
      deepEval: deep,
      evaluatedBy: opts.evaluatedBy ?? null,
    });
  }
  const evaluationId = evaluation.id;

  try {
    const dims: DimensionScore[] = [...runHeuristicChecks(ctx), retrievabilityScore(ctx)];

    if (deep) {
      // Phase 2: run llm-judge (accuracy/completeness/clarity) via
      // createEvaluationJudgeQuery (agent/client.ts) — see evaluators/llm-judge.ts.
      // Until then deep is a no-op over the LLM dims; status stays heuristic_done.
    }

    const overallScore = computeOverallScore(
      dims.map((d) => ({ dimensionKey: d.dimensionKey, score: d.score })),
    );
    const tier = tierForScore(overallScore);
    // Phase 1: heuristic+probe only → 'heuristic_done'. Phase 2 deep → 'complete'.
    const status: EvaluationStatus = 'heuristic_done';

    evalRepo.clearDimensions(evaluationId);
    for (const d of dims) {
      evalRepo.insertDimension({
        evaluationId,
        dimensionKey: d.dimensionKey,
        tier: d.tier,
        score: d.score,
        weight: d.weight,
        rationale: d.rationale ?? null,
        detailJson: d.detail ? JSON.stringify(d.detail) : null,
      });
    }
    evalRepo.updateEvaluation(evaluationId, { tier, overallScore, status, deepEval: deep });

    return {
      evaluationId,
      draftId,
      tier,
      overallScore,
      status,
      deepEval: deep,
      dimensions: dims,
      errorMessage: null,
      evaluatedAt: utcNow(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    evalRepo.updateEvaluation(evaluationId, { status: 'failed', errorMessage: message });
    return {
      evaluationId,
      draftId,
      tier: 'pending',
      overallScore: 0,
      status: 'failed',
      deepEval: deep,
      dimensions: [],
      errorMessage: message,
      evaluatedAt: utcNow(),
    };
  }
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export async function submitFeedback(
  draftId: string,
  payload: FeedbackPayload,
  authorId: string,
): Promise<{ feedbackId: string }> {
  const draft = knowledgeRepo.getDraft(draftId);
  if (!draft) throw new AppError('NOT_FOUND', `Draft ${draftId} not found`);

  const evaluation = evalRepo.getEvaluationByDraftId(draftId);
  const feedback = evalRepo.createFeedback({
    draftId,
    evaluationId: evaluation?.id ?? null,
    authorId,
    dimensionRatingsJson: payload.dimensionRatings
      ? JSON.stringify(payload.dimensionRatings)
      : null,
    comments: payload.comments ?? null,
    improvementInstructionsJson: payload.improvementInstructions
      ? JSON.stringify(payload.improvementInstructions)
      : null,
  });

  recordAudit({
    actorId: authorId,
    action: 'knowledge.feedback',
    resource: 'knowledge_draft',
    resourceId: draftId,
    changes: { feedbackId: feedback.id },
  });

  return { feedbackId: feedback.id };
}

// ---------------------------------------------------------------------------
// Re-clean (manual feedback-driven loop)
// ---------------------------------------------------------------------------

export async function reCleanWithFeedback(
  draftId: string,
  userId: string,
): Promise<ReCleanResult> {
  const draft = knowledgeRepo.getDraft(draftId);
  if (!draft) throw new AppError('NOT_FOUND', `Draft ${draftId} not found`);
  if (draft.status !== 'pending_review') {
    throw new AppError(
      'INVALID_STATE',
      `Draft must be in pending_review to re-clean, got '${draft.status}'`,
    );
  }

  const job = jobsRepo.getJob(draft.jobId);
  if (!job) throw new AppError('NOT_FOUND', `Job for draft ${draftId} not found`);
  const sourceId = job.sourceId;

  // Fold all unapplied feedback for this draft into the cleaner instructions.
  const allFeedback = evalRepo.listFeedbackByDraft(draftId);
  const pending = allFeedback.filter((f) => f.appliedToJobId === null);

  const dimensionRatings = pending
    .filter((f) => f.dimensionRatingsJson)
    .map((f) => JSON.parse(f.dimensionRatingsJson as string) as Record<string, number>)
    .reduce<Record<string, number>>((acc, r) => ({ ...acc, ...r }), {});
  const comments = pending.map((f) => f.comments).filter((c): c is string => Boolean(c));
  const improvementInstructions = pending
    .filter((f) => f.improvementInstructionsJson)
    .map((f) => JSON.parse(f.improvementInstructionsJson as string) as Record<string, unknown>)
    .reduce<Record<string, unknown>>((acc, r) => ({ ...acc, ...r }), {});

  const instructionsPayload = {
    summary: `Re-clean draft ${draftId} (v${draft.version}) with ${pending.length} reviewer feedback entr${pending.length === 1 ? 'y' : 'ies'}`,
    dimensionRatings,
    comments,
    improvementInstructions,
    parentDraftId: draftId,
    parentVersion: draft.version,
  };
  const instructionsJson = JSON.stringify(instructionsPayload);

  const { jobId } = await jobsService.submitJobWithInstructions(sourceId, {
    instructionsJson,
    parentDraftId: draftId,
    kind: 're_clean',
  });

  evalRepo.markFeedbackApplied(pending.map((f) => f.id), jobId);

  recordAudit({
    actorId: userId,
    action: 'knowledge.reclean',
    resource: 'knowledge_draft',
    resourceId: draftId,
    changes: { jobId, kind: 're_clean', parentDraftId: draftId, feedbackCount: pending.length },
  });

  return {
    jobId,
    draftId,
    parentDraftId: draftId,
    version: draft.version + 1,
    instructionsJson,
  };
}

// ---------------------------------------------------------------------------
// Read paths
// ---------------------------------------------------------------------------

export function getEvaluation(draftId: string): EvaluationResult | null {
  const evaluation = evalRepo.getEvaluationByDraftId(draftId);
  if (!evaluation) return null;
  const dims: DimensionScore[] = evalRepo.listDimensions(evaluation.id).map((d) => ({
    dimensionKey: d.dimensionKey as EvalDimensionKey,
    tier: d.tier,
    score: d.score,
    weight: d.weight,
    rationale: d.rationale ?? undefined,
    detail: d.detailJson ? (JSON.parse(d.detailJson) as Record<string, unknown>) : undefined,
  }));
  return {
    evaluationId: evaluation.id,
    draftId,
    tier: evaluation.tier,
    overallScore: evaluation.overallScore,
    status: evaluation.status,
    deepEval: evaluation.deepEval,
    dimensions: dims,
    errorMessage: evaluation.errorMessage,
    evaluatedAt: evaluation.updatedAt,
  };
}

export function listEvaluations(params: {
  tier?: string;
  status?: string;
  cursor?: string;
  limit?: number;
}) {
  return evalRepo.listEvaluations(params);
}

export function getFeedback(draftId: string) {
  return evalRepo.listFeedbackByDraft(draftId);
}

export function getDraftVersions(draftId: string) {
  return evalRepo.getDraftVersions(draftId);
}
