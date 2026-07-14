/**
 * Atomic publisher — SPEC §13.6 eight-step publish algorithm.
 *
 * 1. CAS job pending_review -> publishing (short transaction)
 * 2. Write draft to temp file + fsync
 * 3. Parse & verify temp file (validate path within allowed categories)
 * 4. Backup existing target file
 * 5. Atomic rename candidate -> target
 * 6. Deterministic rebuild of index.md
 * 7. Second short transaction — upsert knowledge_items + job -> published + audit log
 * 8. Git commit + async push
 *
 * On any failure in steps 2-6 the backup is restored and the job is rolled back.
 *
 * @module knowledge/publisher
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';
import { rebuildIndex, writeIndex } from './wiki-index';
import { parseFrontMatter, generateWikiPath } from './front-matter';
import * as knowledgeRepo from './repository';
import * as jobsRepo from '@/modules/jobs/repository';
import { getPublishGuardSettings, getEvaluationByDraftId } from '@/modules/knowledge-evaluation/repository';
import { AppError } from '@/lib/errors';
import { generateId } from '@/lib/uuid';
import { utcNow } from '@/lib/datetime';
import { env } from '@/config/env';
import { getDb } from '@/db/client';
import { auditLogs } from '@/db/schema/admin';
import type { PublishResult } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PublishInput {
  draftId: string;
  jobId: string;
  draftContent: string; // Markdown + Front Matter
  reviewedBy: string;
}

// ---------------------------------------------------------------------------
// Audit log helper
// ---------------------------------------------------------------------------

function writeAuditLog(params: {
  actorId: string;
  action: string;
  resource: string;
  resourceId: string;
  changesJson?: string;
}): void {
  const db = getDb();
  const record = {
    id: generateId(),
    actorId: params.actorId,
    action: params.action,
    resource: params.resource,
    resourceId: params.resourceId,
    requestId: null,
    ipHash: null,
    changesJson: params.changesJson ?? null,
    createdAt: utcNow(),
  };
  db.insert(auditLogs).values(record).run();
}

// ---------------------------------------------------------------------------
// Eight-step atomic publish
// ---------------------------------------------------------------------------

/**
 * Publish a reviewed draft to the wiki using the eight-step atomic algorithm.
 *
 * On success the draft content is written to the wiki root, the knowledge item
 * is upserted, the job is completed, and a git commit is created.
 *
 * On failure (steps 2-6) the original file is restored from backup and the job
 * is rolled back to pending_review.
 */
export async function publishDraft(input: PublishInput): Promise<PublishResult> {
  const wikiRoot = env.WIKI_ROOT;
  const { draftContent, draftId, jobId, reviewedBy } = input;

  // Evaluation publish guard — when enabled in system_settings, require a
  // passing evaluation before publishing. Mirrors service.approveDraft so the
  // guard applies on both the initial publish and revision (overwrite) path.
  // Runs before the CAS so a failing guard leaves the job in pending_review.
  const guard = getPublishGuardSettings();
  if (guard.enabled) {
    const evaluation = getEvaluationByDraftId(draftId);
    const passed =
      !!evaluation &&
      (evaluation.status === 'heuristic_done' || evaluation.status === 'complete') &&
      evaluation.overallScore >= guard.minScore;
    if (!passed) {
      throw new AppError(
        'INVALID_STATE',
        `评估未通过发布门禁（需 ≥${guard.minScore} 分且评估完成，当前 ${
          evaluation ? `${evaluation.overallScore} 分 / ${evaluation.status}` : '未评估'
        }）`,
      );
    }
  }

  // Step 1: CAS job pending_review -> publishing (short transaction)
  const updated = jobsRepo.updateJobStatus(jobId, 'pending_review', 'publishing');
  if (!updated) {
    throw new AppError(
      'INVALID_STATE',
      'Job is not in pending_review state — cannot publish',
    );
  }

  // Parse Front Matter and generate target path
  const parsed = parseFrontMatter(draftContent);
  const wikiPath = generateWikiPath(parsed.frontMatter);
  const targetPath = path.join(wikiRoot, wikiPath);
  const tmpPath = targetPath + '.tmp';
  const bakPath = targetPath + '.bak';

  try {
    // Step 2: Write draft to temp file + fsync
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const fd = fs.openSync(tmpPath, 'w');
    fs.writeSync(fd, draftContent);
    fs.fsyncSync(fd);
    fs.closeSync(fd);

    // Step 3: Parse & verify temp file (confirms path within allowed categories)
    const verifyContent = fs.readFileSync(tmpPath, 'utf-8');
    parseFrontMatter(verifyContent); // throws if invalid

    // Step 4: Backup existing target file
    if (fs.existsSync(targetPath)) {
      fs.copyFileSync(targetPath, bakPath);
    }

    // Step 5: Atomic rename candidate -> target
    fs.renameSync(tmpPath, targetPath);

    // Step 6: Deterministic rebuild of index.md
    const indexContent = rebuildIndex(wikiRoot);
    writeIndex(wikiRoot, indexContent);

    // Step 7: Second short transaction — upsert knowledge_items + job -> published + audit log
    const existing = knowledgeRepo.getItemByWikiPath(wikiPath);
    let itemId: string;

    if (existing) {
      // Overwrite scenario (revision) — update the existing item in place so the
      // uniqueIndex(wikiPath) is not violated. Point it at the revised draft and
      // reset status to 'published' in case the prior version was archived.
      itemId = existing.id;
      knowledgeRepo.updateItem(itemId, {
        title: parsed.frontMatter.title,
        category: parsed.frontMatter.category as 'track-technique' | 'car-setup' | 'basics',
        subcategory: parsed.frontMatter.subcategory,
        tagsJson: JSON.stringify(parsed.frontMatter.tags),
        sourceName: parsed.frontMatter.source_name ?? null,
        sourceUrl: parsed.frontMatter.source_url ?? null,
        season: parsed.frontMatter.season ?? '',
        publishedBy: reviewedBy,
        publishedAt: utcNow(),
        draftId,
        status: 'published' as const,
      });
    } else {
      // New item
      itemId = generateId();
      knowledgeRepo.createItem({
        sourceId: (jobsRepo.getJob(jobId) as any).sourceId,
        draftId,
        title: parsed.frontMatter.title,
        category: parsed.frontMatter.category as 'track-technique' | 'car-setup' | 'basics',
        subcategory: parsed.frontMatter.subcategory,
        tagsJson: JSON.stringify(parsed.frontMatter.tags),
        sourceName: parsed.frontMatter.source_name ?? null,
        sourceUrl: parsed.frontMatter.source_url ?? null,
        season: parsed.frontMatter.season ?? '',
        wikiPath,
        status: 'published',
        gitCommitSha: null,
        wikiSyncStatus: 'committed',
        publishedBy: reviewedBy,
        publishedAt: utcNow(),
      });
    }

    // Mark the draft approved + supersede any sibling pending drafts for the same
    // source (defensive — worker/revise already supersede at creation time, so
    // this is usually a no-op). Mirrors service.approveDraft ordering so the
    // draft reflects the review outcome after the atomic publish.
    const publishJob = jobsRepo.getJob(jobId);
    if (publishJob) {
      knowledgeRepo.supersedeOldDrafts(publishJob.sourceId, draftId);
    }
    knowledgeRepo.updateDraft(draftId, {
      status: 'approved',
      reviewedBy,
      reviewedAt: utcNow(),
    });

    // Complete job: publishing -> published
    jobsRepo.updateJobStatus(jobId, 'publishing', 'published');

    // Write audit log
    writeAuditLog({
      actorId: reviewedBy,
      action: 'knowledge.published',
      resource: 'knowledge_item',
      resourceId: itemId,
      changesJson: JSON.stringify({ draftId, wikiPath }),
    });

    // Step 8: Git commit + async push
    let gitCommitSha: string | null = null;
    let wikiSyncStatus: string = 'committed';
    try {
      // Git add + commit (only target document + index.md)
      execSync(`git add "${wikiPath}" index.md`, { cwd: wikiRoot });
      execSync(
        `git commit -m "knowledge: ${parsed.frontMatter.title} [${draftId}]"`,
        { cwd: wikiRoot },
      );
      gitCommitSha = execSync('git rev-parse HEAD', { cwd: wikiRoot })
        .toString()
        .trim();

      // Async push (non-blocking)
      if (env.WIKI_GIT_REMOTE) {
        const push = spawn(
          'git',
          ['push', env.WIKI_GIT_REMOTE, env.WIKI_GIT_BRANCH],
          { cwd: wikiRoot, detached: true, stdio: 'ignore' },
        );
        push.on('error', () => {
          /* push failure is non-blocking */
        });
        wikiSyncStatus = 'pushed'; // optimistic
      }
    } catch {
      // Git failure is non-blocking — mark as push_failed
      wikiSyncStatus = 'push_failed';
    }

    // Update item sync status
    knowledgeRepo.updateSyncStatus(itemId, wikiSyncStatus, gitCommitSha ?? undefined);

    return { itemId, wikiPath, gitCommitSha, wikiSyncStatus };
  } catch (error) {
    // Steps 2-6 failure -> backup restore + job rollback
    if (fs.existsSync(bakPath)) {
      fs.copyFileSync(bakPath, targetPath);
    } else if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    // Clean up temp file
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);

    // Rollback job status
    jobsRepo.updateJobStatus(jobId, 'publishing', 'pending_review');

    throw error;
  } finally {
    // Always clean up backup file
    if (fs.existsSync(bakPath)) fs.unlinkSync(bakPath);
  }
}

// ---------------------------------------------------------------------------
// Retry Git push
// ---------------------------------------------------------------------------

/**
 * Retry Git push for an item that is in push_failed state.
 */
export async function retryGitPush(itemId: string): Promise<void> {
  const item = knowledgeRepo.getItem(itemId);
  if (!item || item.wikiSyncStatus !== 'push_failed') {
    throw new AppError(
      'INVALID_STATE',
      'Item is not in push_failed state — cannot retry push',
    );
  }
  try {
    execSync(`git push ${env.WIKI_GIT_REMOTE} ${env.WIKI_GIT_BRANCH}`, {
      cwd: env.WIKI_ROOT,
    });
    knowledgeRepo.updateSyncStatus(itemId, 'pushed', item.gitCommitSha ?? undefined);
  } catch {
    // Still failed — keep push_failed status
  }
}
