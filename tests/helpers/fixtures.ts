import { generateId } from '@/lib/uuid';
import { utcNow } from '@/lib/datetime';
import type {
  NewUser,
  NewChatSession,
  NewMessage,
  NewKnowledgeSource,
  NewKnowledgeJob,
  NewKnowledgeDraft,
  NewKnowledgeItem,
} from '@/db/schema';

/**
 * 生成测试用 User 数据。
 */
export function makeUser(overrides?: Partial<NewUser>): NewUser {
  const now = utcNow();
  return {
    id: generateId(),
    username: `testuser_${Math.random().toString(36).slice(2, 8)}`,
    passwordHash: '$2b$12$fakehashfortestingonly',
    role: 'user',
    status: 'active',
    registrationReason: null,
    rejectionReason: null,
    createdAt: now,
    updatedAt: now,
    approvedAt: now,
    lastLoginAt: null,
    approvedBy: null,
    ...overrides,
  };
}

/**
 * 生成测试用 ChatSession 数据。
 */
export function makeSession(userId: string, overrides?: Partial<NewChatSession>): NewChatSession {
  const now = utcNow();
  return {
    id: generateId(),
    userId,
    title: '测试会话',
    qoderSessionId: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
    ...overrides,
  };
}

/**
 * 生成测试用 Message 数据。
 */
export function makeMessage(
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  overrides?: Partial<NewMessage>,
): NewMessage {
  const now = utcNow();
  return {
    id: generateId(),
    sessionId,
    role,
    status: 'complete',
    content: role === 'user' ? '测试问题' : '测试回答',
    replyToMessageId: null,
    errorCode: null,
    tokenInput: 0,
    tokenOutput: 0,
    costMicrousd: 0,
    durationMs: 0,
    createdAt: now,
    completedAt: now,
    ...overrides,
  };
}

// ─── Knowledge fixtures ──────────────────────────────────────────────────────

/**
 * 生成测试用 KnowledgeSource 数据。
 */
export function makeKnowledgeSource(
  submittedBy: string,
  overrides?: Partial<NewKnowledgeSource>,
): NewKnowledgeSource {
  const now = utcNow();
  return {
    id: generateId(),
    inputType: 'file',
    originalName: 'test-document.txt',
    mimeType: 'text/plain',
    relativePath: 'uploads/test-document.txt',
    sourceUrl: null,
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    sizeBytes: 1024,
    status: 'stored',
    submittedBy,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * 生成测试用 KnowledgeJob 数据。
 */
export function makeKnowledgeJob(
  sourceId: string,
  overrides?: Partial<NewKnowledgeJob>,
): NewKnowledgeJob {
  const now = utcNow();
  return {
    id: generateId(),
    sourceId,
    status: 'queued',
    attempt: 0,
    maxAttempts: 3,
    availableAt: now,
    leaseOwner: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    progress: 0,
    errorCode: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * 生成测试用 KnowledgeDraft 数据。
 */
export function makeKnowledgeDraft(
  jobId: string,
  overrides?: Partial<NewKnowledgeDraft>,
): NewKnowledgeDraft {
  const now = utcNow();
  return {
    id: generateId(),
    jobId,
    suggestedPath: 'driving-technique/braking/test-article.md',
    title: 'Test Knowledge Article',
    frontMatterJson: JSON.stringify({ category: 'driving-technique', subcategory: 'braking' }),
    draftRelativePath: 'drafts/test-article.md',
    contentSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    status: 'pending_review',
    reviewNotes: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * 生成测试用 KnowledgeItem 数据。
 */
export function makeKnowledgeItem(
  sourceId: string,
  draftId: string,
  publishedBy: string,
  overrides?: Partial<NewKnowledgeItem>,
): NewKnowledgeItem {
  const now = utcNow();
  return {
    id: generateId(),
    sourceId,
    draftId,
    title: 'Test Knowledge Item',
    category: 'driving-technique',
    subcategory: 'braking',
    tagsJson: JSON.stringify(['tire-management', 'hotfix']),
    sourceName: 'test-document.txt',
    sourceUrl: null,
    season: '2026-S1',
    wikiPath: 'driving-technique/braking/test-article.md',
    status: 'published',
    gitCommitSha: null,
    wikiSyncStatus: 'committed',
    publishedBy,
    publishedAt: now,
    updatedAt: now,
    ...overrides,
  };
}
