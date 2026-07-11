import { describe, it, expect } from 'vitest';
import {
  makeUser,
  makeSession,
  makeMessage,
  makeKnowledgeSource,
  makeKnowledgeJob,
  makeKnowledgeDraft,
  makeKnowledgeItem,
} from '../../helpers/fixtures';

// UUID v7 format: 8-4-4-4-12 hex chars
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('makeUser', () => {
  it('returns valid default user data', () => {
    const user = makeUser();
    expect(user.id).toMatch(UUID_RE);
    expect(user.username).toMatch(/^testuser_/);
    expect(user.passwordHash).toBeTruthy();
    expect(user.role).toBe('user');
    expect(user.status).toBe('active');
    expect(user.createdAt).toBeTruthy();
    expect(user.updatedAt).toBeTruthy();
    expect(user.approvedAt).toBeTruthy();
    expect(user.lastLoginAt).toBeNull();
    expect(user.approvedBy).toBeNull();
    expect(user.registrationReason).toBeNull();
    expect(user.rejectionReason).toBeNull();
  });

  it('overrides default values', () => {
    const user = makeUser({ role: 'admin', username: 'custom_name' });
    expect(user.role).toBe('admin');
    expect(user.username).toBe('custom_name');
    // non-overridden fields remain default
    expect(user.status).toBe('active');
  });
});

describe('makeSession', () => {
  it('associates the correct userId', () => {
    const userId = 'user-123';
    const session = makeSession(userId);
    expect(session.userId).toBe(userId);
    expect(session.id).toMatch(UUID_RE);
    expect(session.title).toBe('测试会话');
    expect(session.status).toBe('active');
    expect(session.qoderSessionId).toBeNull();
  });
});

describe('makeMessage', () => {
  it('returns sensible default content for user role', () => {
    const sessionId = 'session-abc';
    const msg = makeMessage(sessionId, 'user');
    expect(msg.sessionId).toBe(sessionId);
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('测试问题');
    expect(msg.status).toBe('complete');
    expect(msg.tokenInput).toBe(0);
    expect(msg.tokenOutput).toBe(0);
    expect(msg.costMicrousd).toBe(0);
    expect(msg.durationMs).toBe(0);
    expect(msg.replyToMessageId).toBeNull();
    expect(msg.errorCode).toBeNull();
  });

  it('returns sensible default content for assistant role', () => {
    const msg = makeMessage('s1', 'assistant');
    expect(msg.content).toBe('测试回答');
    expect(msg.role).toBe('assistant');
  });
});

describe('makeKnowledgeSource', () => {
  it('returns valid default knowledge source data', () => {
    const source = makeKnowledgeSource('user-1');
    expect(source.id).toMatch(UUID_RE);
    expect(source.inputType).toBe('file');
    expect(source.sha256).toBeTruthy();
    expect(source.sizeBytes).toBe(1024);
    expect(source.status).toBe('stored');
    expect(source.submittedBy).toBe('user-1');
    expect(source.createdAt).toBeTruthy();
    expect(source.updatedAt).toBeTruthy();
    expect(source.sourceUrl).toBeNull();
  });

  it('overrides default values', () => {
    const source = makeKnowledgeSource('user-1', {
      inputType: 'url',
      status: 'queued',
      sourceUrl: 'https://example.com',
    });
    expect(source.inputType).toBe('url');
    expect(source.status).toBe('queued');
    expect(source.sourceUrl).toBe('https://example.com');
    // non-overridden fields remain default
    expect(source.sizeBytes).toBe(1024);
  });
});

describe('makeKnowledgeJob', () => {
  it('returns valid default job data', () => {
    const job = makeKnowledgeJob('source-1');
    expect(job.id).toMatch(UUID_RE);
    expect(job.sourceId).toBe('source-1');
    expect(job.status).toBe('queued');
    expect(job.attempt).toBe(0);
    expect(job.maxAttempts).toBe(3);
    expect(job.progress).toBe(0);
    expect(job.leaseOwner).toBeNull();
    expect(job.startedAt).toBeNull();
    expect(job.finishedAt).toBeNull();
    expect(job.createdAt).toBeTruthy();
  });

  it('overrides default values', () => {
    const job = makeKnowledgeJob('source-1', {
      status: 'extracting',
      attempt: 2,
      progress: 50,
    });
    expect(job.status).toBe('extracting');
    expect(job.attempt).toBe(2);
    expect(job.progress).toBe(50);
    // non-overridden fields remain default
    expect(job.maxAttempts).toBe(3);
  });
});

describe('makeKnowledgeDraft', () => {
  it('returns valid default draft data', () => {
    const draft = makeKnowledgeDraft('job-1');
    expect(draft.id).toMatch(UUID_RE);
    expect(draft.jobId).toBe('job-1');
    expect(draft.suggestedPath).toBeTruthy();
    expect(draft.title).toBe('Test Knowledge Article');
    expect(draft.frontMatterJson).toBeTruthy();
    expect(draft.contentSha256).toBeTruthy();
    expect(draft.status).toBe('pending_review');
    expect(draft.reviewNotes).toBeNull();
    expect(draft.reviewedBy).toBeNull();
    expect(draft.createdAt).toBeTruthy();
  });

  it('overrides default values', () => {
    const draft = makeKnowledgeDraft('job-1', {
      status: 'approved',
      title: 'Custom Title',
      reviewedBy: 'admin-1',
    });
    expect(draft.status).toBe('approved');
    expect(draft.title).toBe('Custom Title');
    expect(draft.reviewedBy).toBe('admin-1');
    // non-overridden fields remain default
    expect(draft.jobId).toBe('job-1');
  });
});

describe('makeKnowledgeItem', () => {
  it('returns valid default item data', () => {
    const item = makeKnowledgeItem('source-1', 'draft-1', 'user-1');
    expect(item.id).toMatch(UUID_RE);
    expect(item.sourceId).toBe('source-1');
    expect(item.draftId).toBe('draft-1');
    expect(item.title).toBe('Test Knowledge Item');
    expect(item.category).toBe('track-technique');
    expect(item.subcategory).toBe('braking');
    expect(item.tagsJson).toBeTruthy();
    expect(item.season).toBe('2026-S1');
    expect(item.wikiPath).toBeTruthy();
    expect(item.status).toBe('published');
    expect(item.wikiSyncStatus).toBe('committed');
    expect(item.publishedBy).toBe('user-1');
    expect(item.publishedAt).toBeTruthy();
    expect(item.gitCommitSha).toBeNull();
  });

  it('overrides default values', () => {
    const item = makeKnowledgeItem('source-1', 'draft-1', 'user-1', {
      category: 'car-setup',
      subcategory: 'theory',
      status: 'archived',
      gitCommitSha: 'abc123',
    });
    expect(item.category).toBe('car-setup');
    expect(item.subcategory).toBe('theory');
    expect(item.status).toBe('archived');
    expect(item.gitCommitSha).toBe('abc123');
    // non-overridden fields remain default
    expect(item.publishedBy).toBe('user-1');
  });
});
