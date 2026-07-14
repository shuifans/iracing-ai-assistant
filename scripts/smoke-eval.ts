/**
 * Smoke test — exercises the knowledge-evaluation repository SQL layer
 * end-to-end against a real (temp) migrated DB. No LLM.
 *
 * Validates the layer the mocked unit tests skip: real INSERT/SELECT/UPDATE
 * against knowledge_evaluations / evaluation_dimensions / evaluation_feedback,
 * version lineage via getDraftVersions, publish-guard settings via system_settings,
 * and the re-clean job (instructionsJson + parentDraftId + kind).
 *
 * Run: tsx scripts/smoke-eval.ts
 */

import * as fs from 'fs';
import { runMigrations } from '../src/db/migrate';
import { getDb, getRawDb, closeDb } from '../src/db/client';
import * as evalRepo from '../src/modules/knowledge-evaluation/repository';
import * as knowledgeRepo from '@/modules/knowledge/repository';
import * as jobsRepo from '@/modules/jobs/repository';
import { computeOverallScore, tierForScore, DIMENSIONS } from '../src/modules/knowledge-evaluation/dimensions';
import type { EvalDimensionKey } from '@/config/constants';

const DB_PATH = '/tmp/smoke-eval.sqlite';
const NOW = '2026-07-01T00:00:00.000Z';
let failures = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

async function main(): Promise<void> {
  // getDb() reads process.env.DATABASE_PATH directly (no env.ts validation).
  process.env.DATABASE_PATH = DB_PATH;

  for (const ext of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(DB_PATH + ext);
    } catch {
      /* ignore */
    }
  }

  console.log('Migrating temp DB...');
  runMigrations(DB_PATH, { validate: true });
  const db = getDb();
  const raw = getRawDb();

  // --- FK setup: user + source + job + draft v1 ---
  raw.exec(
    `INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at) ` +
      `VALUES ('u-smoke','smoke','h','admin','active','${NOW}','${NOW}')`,
  );

  const source = knowledgeRepo.createSource({
    inputType: 'url',
    originalName: 'smoke',
    mimeType: 'text/html',
    relativePath: null,
    sourceUrl: 'https://example.com/x',
    sha256: 'sha-smoke-1',
    sizeBytes: 10,
    status: 'stored',
    submittedBy: 'u-smoke',
  });
  const job1 = jobsRepo.enqueueJob(source.id);
  const draft1 = knowledgeRepo.createDraft({
    jobId: job1.id,
    suggestedPath: 'track-technique/braking/smoke.md',
    title: 'Smoke Draft',
    frontMatterJson: '{}',
    draftRelativePath: 'drafts/d1.md',
    contentSha256: 'cs1',
    status: 'pending_review',
    reviewNotes: null,
    reviewedBy: null,
    reviewedAt: null,
    parentDraftId: null,
    version: 1,
  });
  assert(true, `setup: source ${source.id.slice(0, 8)}, job ${job1.id.slice(0, 8)}, draft v1 ${draft1.id.slice(0, 8)}`);

  // --- evaluation: create + dims + finalize + read ---
  const ev = evalRepo.createEvaluation({ draftId: draft1.id, deepEval: false, evaluatedBy: 'u-smoke' });
  assert(ev.status === 'pending' && ev.tier === 'pending', `createEvaluation → status=${ev.status}, tier=${ev.tier}`);

  for (const d of DIMENSIONS.slice(0, 6)) {
    evalRepo.insertDimension({
      evaluationId: ev.id,
      dimensionKey: d.key,
      tier: d.tier,
      score: 90,
      weight: d.weight,
      rationale: 'smoke',
      detailJson: null,
    });
  }
  const dims = evalRepo.listDimensions(ev.id);
  assert(dims.length === 6, `listDimensions → ${dims.length} dims (expected 6)`);

  const overall = computeOverallScore(
    dims.map((d) => ({ dimensionKey: d.dimensionKey as EvalDimensionKey, score: d.score })),
  );
  const tier = tierForScore(overall);
  evalRepo.updateEvaluation(ev.id, { tier, overallScore: overall, status: 'heuristic_done', deepEval: false });
  const got = evalRepo.getEvaluationByDraftId(draft1.id);
  assert(
    !!got && got.tier === tier && got.overallScore === overall && got.status === 'heuristic_done',
    `getEvaluationByDraftId → tier=${got?.tier}, score=${got?.overallScore}, status=${got?.status}`,
  );

  const listed = evalRepo.listEvaluations({});
  assert(listed.items.length === 1 && listed.nextCursor === null, `listEvaluations → ${listed.items.length} item`);

  // --- feedback: create + list + mark applied ---
  const fb = evalRepo.createFeedback({
    draftId: draft1.id,
    evaluationId: ev.id,
    authorId: 'u-smoke',
    dimensionRatingsJson: '{"accuracy":50}',
    comments: 'too verbose',
    improvementInstructionsJson: '{"add":"examples"}',
  });
  const fbs = evalRepo.listFeedbackByDraft(draft1.id);
  assert(fbs.length === 1 && fbs[0]!.appliedToJobId === null, `createFeedback + listFeedbackByDraft → ${fbs.length} (applied=null)`);

  // --- re-clean job carrying feedback ---
  const job2 = jobsRepo.enqueueJobWithInstructions(source.id, {
    instructionsJson: '{"comments":["too verbose"]}',
    parentDraftId: draft1.id,
    kind: 're_clean',
  });
  assert(
    !!job2.instructionsJson && job2.parentDraftId === draft1.id && job2.jobKind === 're_clean',
    `enqueueJobWithInstructions → job ${job2.id.slice(0, 8)} kind=${job2.jobKind}, parent=${job2.parentDraftId?.slice(0, 8)}`,
  );

  evalRepo.markFeedbackApplied([fb.id], job2.id);
  const fbs2 = evalRepo.listFeedbackByDraft(draft1.id);
  assert(fbs2[0]!.appliedToJobId === job2.id, `markFeedbackApplied → appliedToJobId=${fbs2[0]?.appliedToJobId?.slice(0, 8)}`);

  // --- draft v2 + version history ---
  const draft2 = knowledgeRepo.createDraft({
    jobId: job2.id,
    suggestedPath: 'track-technique/braking/smoke.md',
    title: 'Smoke Draft v2',
    frontMatterJson: '{}',
    draftRelativePath: 'drafts/d2.md',
    contentSha256: 'cs2',
    status: 'pending_review',
    reviewNotes: null,
    reviewedBy: null,
    reviewedAt: null,
    parentDraftId: draft1.id,
    version: 2,
  });
  const versions = evalRepo.getDraftVersions(draft2.id);
  assert(
    versions.length === 2 && versions[0]!.version === 2 && versions[1]!.version === 1,
    `getDraftVersions → ${versions.length} versions, order [v${versions[0]?.version}, v${versions[1]?.version}]`,
  );

  // --- publish guard settings (system_settings read) ---
  const guardOff = evalRepo.getPublishGuardSettings();
  assert(
    guardOff.enabled === false && guardOff.minScore === 60,
    `getPublishGuardSettings (default) → enabled=${guardOff.enabled}, minScore=${guardOff.minScore}`,
  );
  raw.exec(
    `INSERT INTO system_settings (id, key, value, description, updated_at) VALUES ('ss1','knowledge.eval.publish_guard_enabled','true','smoke','${NOW}')`,
  );
  raw.exec(
    `INSERT INTO system_settings (id, key, value, description, updated_at) VALUES ('ss2','knowledge.eval.publish_guard_min_score','75','smoke','${NOW}')`,
  );
  const guardOn = evalRepo.getPublishGuardSettings();
  assert(
    guardOn.enabled === true && guardOn.minScore === 75,
    `getPublishGuardSettings (configured) → enabled=${guardOn.enabled}, minScore=${guardOn.minScore}`,
  );

  // unused-import guard (db symbol must be referenced)
  void db;

  closeDb();
  console.log(failures === 0 ? '\n✅ ALL SMOKE CHECKS PASSED' : `\n❌ ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Smoke crashed:', e);
  closeDb();
  process.exit(1);
});
