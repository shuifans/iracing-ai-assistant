/**
 * Recoverable publisher for reviewed knowledge drafts.
 *
 * File replacement and the publishing CAS are compensated until the database
 * transaction commits. Git work happens afterwards and can only change the
 * Wiki sync status; it never rolls back the published file or database state.
 *
 * @module knowledge/publisher
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync, spawn } from 'child_process';
import { rebuildIndex, writeIndex } from './wiki-index';
import { writeKnowledgeAgentContract } from './agent-contract';
import { assertTrustedSourceMetadata, parseFrontMatter, generateWikiPath } from './front-matter';
import * as knowledgeRepo from './repository';
import * as jobsRepo from '@/modules/jobs/repository';
import {
  getPublishGuardSettings,
  getEvaluationByDraftId,
} from '@/modules/knowledge-evaluation/repository';
import { AppError } from '@/lib/errors';
import { utcNow } from '@/lib/datetime';
import { env } from '@/config/env';
import type { WikiSyncStatus } from '@/config/constants';
import type { PublishResult } from './types';

export interface PublishInput {
  draftId: string;
  jobId: string;
  draftContent: string;
  reviewedBy: string;
}

function resolveWikiTarget(wikiRoot: string, wikiPath: string): string {
  const root = path.resolve(wikiRoot);
  const target = path.resolve(root, wikiPath);
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new AppError('DRAFT_INVALID', 'Generated path is outside the Wiki root');
  }
  return target;
}

function updatePushResult(
  itemId: string,
  status: Extract<WikiSyncStatus, 'synced' | 'push_failed'>,
  commitSha: string,
): void {
  knowledgeRepo.completePushAttempt(itemId, commitSha, status);
}

export async function publishDraft(input: PublishInput): Promise<PublishResult> {
  const wikiRoot = env.WIKI_ROOT;
  const { draftContent, draftId, jobId, reviewedBy } = input;

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

  const parsed = parseFrontMatter(draftContent);
  const job = jobsRepo.getJob(jobId);
  const source = job ? knowledgeRepo.getSource(job.sourceId) : null;
  if (!job || !source) {
    throw new AppError('NOT_FOUND', `Source for draft ${draftId} not found`);
  }
  assertTrustedSourceMetadata(parsed.frontMatter, source);
  const wikiPath = generateWikiPath(parsed.frontMatter);
  const targetPath = resolveWikiTarget(wikiRoot, wikiPath);
  const tmpPath = `${targetPath}.tmp`;
  const bakPath = `${targetPath}.bak`;

  const updated = jobsRepo.updateJobStatus(jobId, 'pending_review', 'publishing');
  if (!updated) {
    throw new AppError('INVALID_STATE', 'Job is not in pending_review state — cannot publish');
  }

  let itemId: string;
  let indexUpdated = false;
  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const fd = fs.openSync(tmpPath, 'w');
    try {
      fs.writeSync(fd, draftContent);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    const verifyContent = fs.readFileSync(tmpPath, 'utf-8');
    parseFrontMatter(verifyContent);

    if (fs.existsSync(targetPath)) {
      fs.copyFileSync(targetPath, bakPath);
    }
    fs.renameSync(tmpPath, targetPath);

    const indexContent = rebuildIndex(wikiRoot);
    writeIndex(wikiRoot, indexContent);
    indexUpdated = true;
    writeKnowledgeAgentContract(wikiRoot);

    const publishedAt = utcNow();
    ({ itemId } = knowledgeRepo.commitPublishedDraft({
      jobId,
      draftId,
      reviewedBy,
      wikiPath,
      title: parsed.frontMatter.title,
      category: parsed.frontMatter.category,
      subcategory: parsed.frontMatter.subcategory,
      tagsJson: JSON.stringify(parsed.frontMatter.tags),
      sourceName: parsed.frontMatter.source_name ?? null,
      sourceUrl: parsed.frontMatter.source_url ?? null,
      season: parsed.frontMatter.season ?? '',
      publishedAt,
    }));
  } catch (error) {
    if (fs.existsSync(bakPath)) {
      fs.copyFileSync(bakPath, targetPath);
    } else if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    if (indexUpdated) {
      writeIndex(wikiRoot, rebuildIndex(wikiRoot));
    }
    jobsRepo.updateJobStatus(jobId, 'publishing', 'pending_review');
    throw error;
  } finally {
    if (fs.existsSync(bakPath)) fs.unlinkSync(bakPath);
  }

  let gitCommitSha: string | null = null;
  try {
    execFileSync('git', ['add', '--', wikiPath, 'index.md', 'KNOWLEDGE.md'], {
      cwd: wikiRoot,
    });
    execFileSync('git', ['commit', '-m', `knowledge: ${parsed.frontMatter.title} [${draftId}]`], {
      cwd: wikiRoot,
    });
    gitCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wikiRoot }).toString().trim();
  } catch {
    knowledgeRepo.updateSyncStatus(itemId, 'push_failed');
    return {
      itemId,
      wikiPath,
      gitCommitSha: null,
      wikiSyncStatus: 'push_failed',
    };
  }

  if (!env.WIKI_GIT_REMOTE) {
    knowledgeRepo.updateSyncStatus(itemId, 'committed', gitCommitSha);
    return { itemId, wikiPath, gitCommitSha, wikiSyncStatus: 'committed' };
  }

  knowledgeRepo.updateSyncStatus(itemId, 'push_pending', gitCommitSha);
  let push;
  try {
    push = spawn('git', ['push', env.WIKI_GIT_REMOTE, env.WIKI_GIT_BRANCH], {
      cwd: wikiRoot,
      detached: true,
      stdio: 'ignore',
    });
  } catch {
    updatePushResult(itemId, 'push_failed', gitCommitSha);
    return { itemId, wikiPath, gitCommitSha, wikiSyncStatus: 'push_failed' };
  }

  let settled = false;
  const settle = (status: Extract<WikiSyncStatus, 'synced' | 'push_failed'>) => {
    if (settled) return;
    settled = true;
    updatePushResult(itemId, status, gitCommitSha!);
  };
  push.on('error', () => settle('push_failed'));
  push.on('exit', (code) => settle(code === 0 ? 'synced' : 'push_failed'));
  push.unref();

  return { itemId, wikiPath, gitCommitSha, wikiSyncStatus: 'push_pending' };
}

/** Retry a failed Git push synchronously so success is known before `synced`. */
export async function retryGitPush(itemId: string): Promise<void> {
  const item = knowledgeRepo.getItem(itemId);
  if (!item || item.wikiSyncStatus !== 'push_failed') {
    throw new AppError('INVALID_STATE', 'Item is not in push_failed state — cannot retry push');
  }

  let commitSha = item.gitCommitSha;
  if (!commitSha) {
    try {
      execFileSync('git', ['add', '--', item.wikiPath, 'index.md', 'KNOWLEDGE.md'], {
        cwd: env.WIKI_ROOT,
      });
      execFileSync('git', ['commit', '-m', `knowledge: ${item.title} [${item.draftId}]`], {
        cwd: env.WIKI_ROOT,
      });
      commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: env.WIKI_ROOT })
        .toString()
        .trim();
    } catch {
      return;
    }
  }

  knowledgeRepo.updateSyncStatus(itemId, 'push_pending', commitSha);
  try {
    execFileSync('git', ['push', env.WIKI_GIT_REMOTE!, env.WIKI_GIT_BRANCH], {
      cwd: env.WIKI_ROOT,
    });
    knowledgeRepo.completePushAttempt(itemId, commitSha, 'synced');
  } catch {
    knowledgeRepo.completePushAttempt(itemId, commitSha, 'push_failed');
  }
}
