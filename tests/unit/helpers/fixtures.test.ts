import { describe, it, expect } from 'vitest';
import { makeUser, makeSession, makeMessage } from '../../helpers/fixtures';

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
