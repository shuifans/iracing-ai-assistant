import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadHistoryContext,
  generateSessionTitle,
  MAX_TURNS,
  MAX_HISTORY_CHARS,
} from '@/modules/chat/session-context';

// Mock the repository module
vi.mock('@/modules/chat/repository', () => ({
  getMessagesBySession: vi.fn(),
}));

import { getMessagesBySession } from '@/modules/chat/repository';

const mockGetMessages = vi.mocked(getMessagesBySession);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(role: string, content: string, status = 'complete') {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    sessionId: 'sess-001',
    role: role as 'user' | 'assistant' | 'system',
    status,
    content,
    replyToMessageId: null,
    errorCode: null,
    tokenInput: 0,
    tokenOutput: 0,
    costMicrousd: 0,
    durationMs: 0,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
}

// ---------------------------------------------------------------------------
// loadHistoryContext
// ---------------------------------------------------------------------------

describe('loadHistoryContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty string when no messages exist', () => {
    mockGetMessages.mockReturnValue([]);
    const result = loadHistoryContext('sess-001');
    expect(result).toBe('');
  });

  it('formats user and assistant messages correctly', () => {
    mockGetMessages.mockReturnValue([
      makeMessage('user', 'What is trail braking?'),
      makeMessage('assistant', 'Trail braking is a technique...', 'complete'),
    ]);
    const result = loadHistoryContext('sess-001');
    expect(result).toContain('User: What is trail braking?');
    expect(result).toContain('Assistant: Trail braking is a technique...');
  });

  it('excludes system messages', () => {
    mockGetMessages.mockReturnValue([
      makeMessage('system', 'System initialization'),
      makeMessage('user', 'Hello'),
      makeMessage('assistant', 'Hi there', 'complete'),
    ]);
    const result = loadHistoryContext('sess-001');
    expect(result).not.toContain('System:');
    expect(result).toContain('User: Hello');
  });

  it('excludes incomplete assistant messages', () => {
    mockGetMessages.mockReturnValue([
      makeMessage('user', 'Question'),
      makeMessage('assistant', '', 'pending'),
      makeMessage('assistant', 'Complete answer', 'complete'),
    ]);
    const result = loadHistoryContext('sess-001');
    expect(result).toContain('User: Question');
    expect(result).toContain('Assistant: Complete answer');
    expect(result).not.toContain('Assistant: \n');
  });

  it('trims to MAX_TURNS * 2 messages (most recent)', () => {
    // Create 50 messages (25 turns)
    const messages = [];
    for (let i = 0; i < 50; i++) {
      const role = i % 2 === 0 ? 'user' : 'assistant';
      messages.push(makeMessage(role, `Message ${i}`));
    }
    mockGetMessages.mockReturnValue(messages);

    const result = loadHistoryContext('sess-001');
    const lines = result
      .split('\n')
      .filter((l) => l.startsWith('User:') || l.startsWith('Assistant:'));

    // Should have at most MAX_TURNS * 2 = 40 messages
    expect(lines.length).toBeLessThanOrEqual(MAX_TURNS * 2);
    // Should include the most recent messages
    expect(result).toContain('Message 49');
    expect(result).toContain('Message 48');
  });

  it('trims to MAX_HISTORY_CHARS when content is too long', () => {
    // Create messages with very long content
    const longContent = 'A'.repeat(5000);
    const messages = [];
    for (let i = 0; i < 20; i++) {
      const role = i % 2 === 0 ? 'user' : 'assistant';
      messages.push(makeMessage(role, longContent));
    }
    mockGetMessages.mockReturnValue(messages);

    const result = loadHistoryContext('sess-001');

    // Result should be under MAX_HISTORY_CHARS
    expect(result.length).toBeLessThanOrEqual(MAX_HISTORY_CHARS + 1000); // Allow some margin for formatting
  });

  it('handles exactly MAX_TURNS turns without trimming', () => {
    const messages = [];
    for (let i = 0; i < MAX_TURNS * 2; i++) {
      const role = i % 2 === 0 ? 'user' : 'assistant';
      messages.push(makeMessage(role, `Turn ${Math.floor(i / 2)} - ${role}`));
    }
    mockGetMessages.mockReturnValue(messages);

    const result = loadHistoryContext('sess-001');
    const lines = result
      .split('\n')
      .filter((l) => l.startsWith('User:') || l.startsWith('Assistant:'));

    expect(lines.length).toBe(MAX_TURNS * 2);
  });
});

// ---------------------------------------------------------------------------
// generateSessionTitle
// ---------------------------------------------------------------------------

describe('generateSessionTitle', () => {
  it('returns default title for empty string', () => {
    expect(generateSessionTitle('')).toBe('新会话');
  });

  it('truncates to 30 characters with ellipsis', () => {
    const longText =
      '这是一个非常非常非常长的标题内容，用来测试截断功能是否在超过三十个字符时正常工作';
    const result = generateSessionTitle(longText);
    // Should be at most 33 chars (30 + "...")
    expect(Array.from(result).length).toBeLessThanOrEqual(33);
    expect(result).toContain('...');
  });

  it('does not add ellipsis for short titles', () => {
    const shortText = '简短标题';
    const result = generateSessionTitle(shortText);
    expect(result).not.toContain('...');
    expect(result).toBe('简短标题');
  });

  it('strips markdown headers (###)', () => {
    expect(generateSessionTitle('### Trail Braking 技巧')).toBe('Trail Braking 技巧');
  });

  it('strips bold formatting (**text**)', () => {
    expect(generateSessionTitle('**重要的** racing technique')).toBe('重要的 racing technique');
  });

  it('strips italic formatting (*text*)', () => {
    expect(generateSessionTitle('*italic* text here')).toBe('italic text here');
  });

  it('strips inline code (`code`)', () => {
    expect(generateSessionTitle('Use `trailBraking()` function')).toBe(
      'Use trailBraking() function',
    );
  });

  it('strips links [text](url)', () => {
    expect(generateSessionTitle('See [this guide](https://example.com) for details')).toBe(
      'See this guide for details',
    );
  });

  it('strips blockquotes (>)', () => {
    expect(generateSessionTitle('> This is a quote')).toBe('This is a quote');
  });

  it('strips list markers (-, *)', () => {
    expect(generateSessionTitle('- First item\n- Second item')).toBe('First item Second item');
  });

  it('handles multiple markdown elements', () => {
    const markdown = '## **Trail Braking**\n\nA *technique* using `brake()` method';
    const result = generateSessionTitle(markdown);
    expect(result).not.toContain('##');
    expect(result).not.toContain('**');
    expect(result).not.toContain('*');
    expect(result).not.toContain('`');
    expect(result).toContain('Trail Braking');
  });

  it('handles Unicode characters correctly (Chinese, emoji)', () => {
    const text = 'iRacing 赛车技巧 🏎️ 和设置指南';
    const result = generateSessionTitle(text);
    // Should properly count Unicode characters
    expect(result).toContain('iRacing');
  });

  it('collapses multiple newlines into spaces', () => {
    expect(generateSessionTitle('Line 1\n\n\nLine 2')).toBe('Line 1 Line 2');
  });

  it('trims leading and trailing whitespace', () => {
    expect(generateSessionTitle('   padded text   ')).toBe('padded text');
  });
});
