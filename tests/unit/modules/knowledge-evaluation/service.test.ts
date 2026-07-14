import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@/modules/knowledge-evaluation/repository', () => ({
  getEvaluation: vi.fn(),
  getEvaluationByDraftId: vi.fn(),
  createEvaluation: vi.fn(),
  updateEvaluation: vi.fn(),
  listEvaluations: vi.fn(),
  listDimensions: vi.fn(),
  clearDimensions: vi.fn(),
  insertDimension: vi.fn(),
  createFeedback: vi.fn(),
  listFeedbackByDraft: vi.fn(),
  markFeedbackApplied: vi.fn(),
  getDraftVersions: vi.fn(),
  getPublishGuardSettings: vi.fn(),
}));
vi.mock('@/modules/knowledge/repository', () => ({
  getDraft: vi.fn(),
  getSource: vi.fn(),
}));
vi.mock('@/modules/jobs/repository', () => ({ getJob: vi.fn() }));
vi.mock('@/modules/jobs/service', () => ({ submitJobWithInstructions: vi.fn() }));
vi.mock('@/modules/audit/service', () => ({ recordAudit: vi.fn() }));
vi.mock('@/modules/knowledge/wiki-index', () => ({ collectIndexEntries: vi.fn() }));
vi.mock('fs', () => ({ existsSync: vi.fn(), readFileSync: vi.fn() }));
vi.mock('@/config/env', () => ({
  env: { DATA_ROOT: '/data', WIKI_ROOT: '/data/md-wiki' },
}));

import {
  evaluateDraft,
  submitFeedback,
  reCleanWithFeedback,
} from '@/modules/knowledge-evaluation/service';
import * as evalRepo from '@/modules/knowledge-evaluation/repository';
import * as knowledgeRepo from '@/modules/knowledge/repository';
import * as jobsRepo from '@/modules/jobs/repository';
import * as jobsService from '@/modules/jobs/service';
import { recordAudit } from '@/modules/audit/service';
import { collectIndexEntries } from '@/modules/knowledge/wiki-index';
import * as fs from 'fs';

const mockGetDraft = vi.mocked(knowledgeRepo.getDraft);
const mockGetSource = vi.mocked(knowledgeRepo.getSource);
const mockGetJob = vi.mocked(jobsRepo.getJob);
const mockSubmitJobWithInstructions = vi.mocked(jobsService.submitJobWithInstructions);
const mockRecordAudit = vi.mocked(recordAudit);
const mockCollectIndexEntries = vi.mocked(collectIndexEntries);
const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockGetEvaluationByDraftId = vi.mocked(evalRepo.getEvaluationByDraftId);
const mockCreateEvaluation = vi.mocked(evalRepo.createEvaluation);
const mockUpdateEvaluation = vi.mocked(evalRepo.updateEvaluation);
const mockClearDimensions = vi.mocked(evalRepo.clearDimensions);
const mockInsertDimension = vi.mocked(evalRepo.insertDimension);
const mockCreateFeedback = vi.mocked(evalRepo.createFeedback);
const mockListFeedbackByDraft = vi.mocked(evalRepo.listFeedbackByDraft);
const mockMarkFeedbackApplied = vi.mocked(evalRepo.markFeedbackApplied);

const VALID_DRAFT_CONTENT = `---
title: Trail Braking Guide
category: track-technique
subcategory: braking
tags: [braking, trail, technique]
---

## Braking Technique
Trail braking is a technique used to carry speed through corners while maintaining control of the car.`;

function makeDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft-1',
    jobId: 'job-1',
    suggestedPath: 'track-technique/braking/trail-braking-guide.md',
    title: 'Trail Braking Guide',
    status: 'pending_review',
    version: 1,
    parentDraftId: null,
    frontMatterJson: '{}',
    draftRelativePath: 'drafts/draft-1.md',
    contentSha256: 'sha',
    reviewNotes: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}
function makeSource() {
  return { id: 'src-1', createdAt: '2026-07-01T00:00:00.000Z' };
}
function makeJob() {
  return { id: 'job-1', sourceId: 'src-1', status: 'pending_review' };
}

describe('knowledge-evaluation/service', () => {
  beforeEach(() => vi.clearAllMocks());

  // ─── evaluateDraft ───────────────────────────────────────────────────────

  describe('evaluateDraft', () => {
    it('runs heuristic+probe, persists 6 dims, returns scorecard', async () => {
      mockGetDraft.mockReturnValue(makeDraft() as any);
      mockGetJob.mockReturnValue(makeJob() as any);
      mockGetSource.mockReturnValue(makeSource() as any);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(VALID_DRAFT_CONTENT);
      mockCollectIndexEntries.mockReturnValue([]);
      mockGetEvaluationByDraftId.mockReturnValue(null);
      mockCreateEvaluation.mockReturnValue({ id: 'eval-1' } as any);

      const result = await evaluateDraft('draft-1');

      expect(result.draftId).toBe('draft-1');
      expect(result.status).toBe('heuristic_done');
      expect(result.dimensions).toHaveLength(6);
      expect(result.overallScore).toBeGreaterThan(0);
      expect(mockCreateEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({ draftId: 'draft-1', deepEval: false }),
      );
      expect(mockClearDimensions).toHaveBeenCalledWith('eval-1');
      expect(mockInsertDimension).toHaveBeenCalledTimes(6);
      expect(mockUpdateEvaluation).toHaveBeenCalledWith(
        'eval-1',
        expect.objectContaining({ status: 'heuristic_done' }),
      );
    });

    it('reuses the existing evaluation row on re-run (no new row)', async () => {
      mockGetDraft.mockReturnValue(makeDraft() as any);
      mockGetJob.mockReturnValue(makeJob() as any);
      mockGetSource.mockReturnValue(makeSource() as any);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(VALID_DRAFT_CONTENT);
      mockCollectIndexEntries.mockReturnValue([]);
      mockGetEvaluationByDraftId.mockReturnValue({ id: 'eval-existing' } as any);

      await evaluateDraft('draft-1');

      expect(mockCreateEvaluation).not.toHaveBeenCalled();
      expect(mockUpdateEvaluation).toHaveBeenCalledWith(
        'eval-existing',
        expect.objectContaining({ status: 'pending' }),
      );
    });

    it('throws NOT_FOUND when draft is missing', async () => {
      mockGetDraft.mockReturnValue(null);
      await expect(evaluateDraft('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ─── submitFeedback ──────────────────────────────────────────────────────

  describe('submitFeedback', () => {
    it('creates feedback + records audit', async () => {
      mockGetDraft.mockReturnValue(makeDraft() as any);
      mockGetEvaluationByDraftId.mockReturnValue(null);
      mockCreateFeedback.mockReturnValue({ id: 'fb-1' } as any);

      const result = await submitFeedback(
        'draft-1',
        { comments: 'too verbose', dimensionRatings: { accuracy: 50 } },
        'user-1',
      );

      expect(result.feedbackId).toBe('fb-1');
      expect(mockCreateFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ draftId: 'draft-1', authorId: 'user-1' }),
      );
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'knowledge.feedback', resourceId: 'draft-1' }),
      );
    });

    it('throws NOT_FOUND when draft missing', async () => {
      mockGetDraft.mockReturnValue(null);
      await expect(submitFeedback('nope', {}, 'user-1')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  // ─── reCleanWithFeedback ─────────────────────────────────────────────────

  describe('reCleanWithFeedback', () => {
    it('enqueues re-clean job carrying feedback + marks feedback applied', async () => {
      mockGetDraft.mockReturnValue(makeDraft({ version: 1 }) as any);
      mockGetJob.mockReturnValue(makeJob() as any);
      mockListFeedbackByDraft.mockReturnValue([
        {
          id: 'fb-1',
          appliedToJobId: null,
          comments: 'too verbose',
          dimensionRatingsJson: '{"accuracy":50}',
          improvementInstructionsJson: '{"add":"telemetry examples"}',
        } as any,
      ]);
      mockSubmitJobWithInstructions.mockResolvedValue({ jobId: 'reclean-job-1' });

      const result = await reCleanWithFeedback('draft-1', 'user-1');

      expect(result.jobId).toBe('reclean-job-1');
      expect(result.parentDraftId).toBe('draft-1');
      expect(result.version).toBe(2);
      expect(mockSubmitJobWithInstructions).toHaveBeenCalledWith(
        'src-1',
        expect.objectContaining({ kind: 're_clean', parentDraftId: 'draft-1' }),
      );
      // The folded instructions carry the feedback content
      const callArgs = mockSubmitJobWithInstructions.mock.calls[0]![1];
      const instr = JSON.parse(callArgs.instructionsJson as string);
      expect(instr.comments).toContain('too verbose');
      expect(instr.dimensionRatings).toEqual({ accuracy: 50 });
      expect(instr.improvementInstructions).toEqual({ add: 'telemetry examples' });
      expect(instr.parentDraftId).toBe('draft-1');
      expect(mockMarkFeedbackApplied).toHaveBeenCalledWith(['fb-1'], 'reclean-job-1');
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'knowledge.reclean' }),
      );
    });

    it('rejects re-clean when draft is not pending_review', async () => {
      mockGetDraft.mockReturnValue(makeDraft({ status: 'approved' }) as any);
      await expect(reCleanWithFeedback('draft-1', 'user-1')).rejects.toMatchObject({
        code: 'INVALID_STATE',
      });
    });
  });
});
