import { generateId } from '@/lib/uuid';
import { utcNow } from '@/lib/datetime';
import type { NewUser, NewChatSession, NewMessage } from '@/db/schema';

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
