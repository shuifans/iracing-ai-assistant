/**
 * Session context — history loading, trimming, and title generation.
 *
 * SPEC §10.5 — multi-turn context:
 * - DB messages are the source of truth
 * - History trimmed to 20 turns (40 messages) or 40,000 chars
 * - qoder_session_id used for resume when available
 *
 * @module chat/session-context
 */

import { getMessagesBySession } from './repository';

// ---------------------------------------------------------------------------
// Constants (SPEC §10.5)
// ---------------------------------------------------------------------------

/** Maximum number of conversation turns (1 turn = 1 user + 1 assistant message) */
export const MAX_TURNS = 20;

/** Maximum character count for history context */
export const MAX_HISTORY_CHARS = 40_000;

// ---------------------------------------------------------------------------
// History context loading
// ---------------------------------------------------------------------------

/**
 * Load and trim conversation history for a session.
 *
 * - Loads all messages from DB (ordered by creation time)
 * - Takes at most MAX_TURNS * 2 messages (20 turns = 40 messages)
 * - Trims from the beginning to stay under MAX_HISTORY_CHARS
 * - Formats as "User: ...\nAssistant: ...\n" text
 * - System messages and the current question are NOT included
 *
 * @param sessionId The chat session ID
 * @returns Formatted history text for injection into system prompt
 */
export function loadHistoryContext(sessionId: string): string {
  const allMessages = getMessagesBySession(sessionId);

  // Filter to only user and assistant messages with content
  const conversationMessages = allMessages.filter(
    (m) => m.role === 'user' || (m.role === 'assistant' && m.status === 'complete'),
  );

  if (conversationMessages.length === 0) {
    return '';
  }

  // Take at most MAX_TURNS * 2 messages (most recent)
  const maxMessages = MAX_TURNS * 2;
  const recentMessages =
    conversationMessages.length > maxMessages
      ? conversationMessages.slice(-maxMessages)
      : conversationMessages;

  // Format messages and trim from beginning if over char limit
  const formatted: { role: string; content: string; chars: number }[] = recentMessages.map((m) => {
    const roleLabel = m.role === 'user' ? 'User' : 'Assistant';
    const content = m.content || '';
    const text = `${roleLabel}: ${content}`;
    return { role: m.role, content: text, chars: text.length };
  });

  // Trim from beginning to stay under MAX_HISTORY_CHARS
  let totalChars = formatted.reduce((sum, m) => sum + m.chars, 0);
  let startIndex = 0;

  while (totalChars > MAX_HISTORY_CHARS && startIndex < formatted.length - 1) {
    totalChars -= formatted[startIndex]!.chars;
    startIndex++;
  }

  // Build final history text
  const trimmedMessages = formatted.slice(startIndex);
  return trimmedMessages.map((m) => m.content).join('\n');
}

// ---------------------------------------------------------------------------
// Title generation (SPEC §11.1 — async, non-blocking)
// ---------------------------------------------------------------------------

/**
 * Generate a session title from the first assistant response.
 *
 * - Simple implementation: extract first 30 characters
 * - Strip markdown formatting
 * - Does NOT call AI (SPEC says "简单实现")
 *
 * @param firstResponse The first assistant response text
 * @returns A title string (≤30 Chinese characters)
 */
export function generateSessionTitle(firstResponse: string): string {
  if (!firstResponse) {
    return '新会话';
  }

  // Strip markdown formatting
  let clean = firstResponse
    // Remove headers (###, ##, #)
    .replace(/^#+\s*/gm, '')
    // Remove bold (**text** or __text__)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    // Remove italic (*text* or _text_)
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    // Remove inline code (`code`)
    .replace(/`(.+?)`/g, '$1')
    // Remove links [text](url)
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    // Remove blockquotes (>)
    .replace(/^>\s*/gm, '')
    // Remove list markers (-, *, 1.)
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    // Collapse multiple whitespace
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Take first 30 characters (Chinese-aware: use Array.from for proper Unicode handling)
  const chars = Array.from(clean);
  if (chars.length > 30) {
    clean = chars.slice(0, 30).join('') + '...';
  }

  return clean || '新会话';
}
