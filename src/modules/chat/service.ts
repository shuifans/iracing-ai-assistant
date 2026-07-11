/**
 * Chat service — core streaming orchestration.
 *
 * SPEC §11.1 — send message flow:
 * 1. Validate user active, session ownership, message length
 * 2. Short transaction: write user message + pending assistant message
 * 3. Return SSE start within 500ms
 * 4. Load history context, start Qoder Query
 * 5. Stream: text_delta → delta, evidence → source
 * 6. On success: write final content + sources + usage + complete
 * 7. On failure: preserve user message, mark assistant failed/interrupted
 * 8. First complete answer → async generate title (≤30 chars)
 *
 * SPEC §11.3 — stop & retry:
 * - Stop: abort query, save generated text, status = interrupted
 * - Retry: new assistant message + reply_to_message_id pointing to same user message
 *
 * @module chat/service
 */

import type { AuthenticatedUser } from '@/modules/auth/types';
import type { SDKMessage } from '@qoder-ai/qoder-agent-sdk';
import type { AgentConfig } from '@/modules/agent/types';
import { createChatQuery } from '@/modules/agent/client';
import { AppError } from '@/lib/errors';
import { generateId } from '@/lib/uuid';
import { utcNow } from '@/lib/datetime';
import {
  createMessage,
  updateMessage,
  getMessage,
  getMessagesBySession,
  getSession,
  createMessageSource,
  updateQoderSessionId,
  getAttachment,
} from './repository';
import { loadHistoryContext, generateSessionTitle } from './session-context';
import type {
  SSEEvent,
  SSEStartEvent,
  SSEDeltaEvent,
  SSESourceEvent,
  SSEUsageEvent,
  SSEDoneEvent,
  SSEErrorEvent,
} from './sse-events';
import type { Evidence } from '@/modules/agent/types';

// ---------------------------------------------------------------------------
// Active queries registry (for stop/cancel)
// ---------------------------------------------------------------------------

const activeQueries = new Map<string, AbortController>();

// ---------------------------------------------------------------------------
// Agent config factory
// ---------------------------------------------------------------------------

function getAgentConfig(): AgentConfig {
  return {
    wikiRoot: process.env.WIKI_ROOT ?? '/data/md-wiki',
    pat: process.env.QODER_PERSONAL_ACCESS_TOKEN ?? '',
    model: process.env.QODER_MODEL,
    chatTimeoutMs: Number(process.env.QODER_CHAT_TIMEOUT_MS ?? 120000),
    cleanTimeoutMs: Number(process.env.QODER_CLEAN_TIMEOUT_MS ?? 900000),
  };
}

// ---------------------------------------------------------------------------
// SSE event factories
// ---------------------------------------------------------------------------

function makeStartEvent(requestId: string, sessionId: string, messageId: string): SSEStartEvent {
  return { requestId, sessionId, messageId, timestamp: utcNow() };
}

function makeDeltaEvent(
  requestId: string,
  sessionId: string,
  messageId: string,
  seq: number,
  text: string,
): SSEDeltaEvent {
  return { requestId, sessionId, messageId, timestamp: utcNow(), seq, text };
}

function makeSourceEvent(
  requestId: string,
  sessionId: string,
  messageId: string,
  source: { id: string; ordinal: number; type: string; title: string; wikiPath?: string; url?: string },
): SSESourceEvent {
  return { requestId, sessionId, messageId, timestamp: utcNow(), source };
}

function makeUsageEvent(
  requestId: string,
  sessionId: string,
  messageId: string,
  inputTokens: number,
  outputTokens: number,
  durationMs: number,
): SSEUsageEvent {
  return { requestId, sessionId, messageId, timestamp: utcNow(), inputTokens, outputTokens, durationMs };
}

function makeDoneEvent(
  requestId: string,
  sessionId: string,
  messageId: string,
  status: 'complete' | 'interrupted',
  grounding: 'grounded' | 'inferred' | 'insufficient',
): SSEDoneEvent {
  return { requestId, sessionId, messageId, timestamp: utcNow(), status, grounding };
}

function makeErrorEvent(
  requestId: string,
  sessionId: string,
  messageId: string,
  code: string,
  message: string,
  retryable: boolean,
): SSEErrorEvent {
  return { requestId, sessionId, messageId, timestamp: utcNow(), code, message, retryable };
}

// ---------------------------------------------------------------------------
// Core streaming function
// ---------------------------------------------------------------------------

/**
 * Stream a chat message response as SSE events.
 *
 * SPEC §11.1 — full send message flow.
 */
export async function* streamChatMessage(
  user: AuthenticatedUser,
  sessionId: string,
  content: string,
  attachmentIds?: string[],
): AsyncGenerator<SSEEvent> {
  const requestId = generateId();

  // 1. Validate session ownership
  const session = getSession(sessionId, user.id);
  if (!session) {
    throw new AppError('NOT_FOUND', 'Session not found or access denied');
  }

  // Validate attachments exist
  if (attachmentIds?.length) {
    for (const aid of attachmentIds) {
      const att = getAttachment(aid);
      if (!att) {
        throw new AppError('NOT_FOUND', `Attachment ${aid} not found`);
      }
    }
  }

  // 2. Short transaction: create user message + pending assistant message
  const userMessage = createMessage(sessionId, 'user', content, 'complete');
  const assistantMessage = createMessage(sessionId, 'assistant', '', 'pending');
  const assistantMsgId = assistantMessage.id;

  // 3. Yield start event
  yield makeStartEvent(requestId, sessionId, assistantMsgId);

  // Track accumulated content and evidence
  let accumulatedContent = '';
  let seq = 0;
  const evidenceList: Evidence[] = [];
  let qoderSessionId: string | undefined;
  let usageData: { inputTokens: number; outputTokens: number; costMicrousd: number; durationMs: number } | null = null;
  let grounding: 'grounded' | 'inferred' | 'insufficient' = 'inferred';
  let completed = false;
  const startTime = Date.now();

  // Set up abort controller
  const abortController = new AbortController();
  activeQueries.set(assistantMsgId, abortController);

  try {
    // 4. Load history context
    const historyContext = loadHistoryContext(sessionId);

    // 5. Create Qoder Query (resume or new)
    const config = getAgentConfig();
    const query = createChatQuery(config, {
      userMessage: content,
      sessionId,
      qoderSessionId: session.qoderSessionId ?? undefined,
      historyContext,
      abortController,
    });

    // 6. Iterate SDK message stream
    for await (const sdkMsg of query) {
      const msg = sdkMsg as SDKMessage;

      // Handle stream_event (partial assistant content)
      if (msg.type === 'stream_event') {
        const event = msg.event;
        // Content block delta — text increment
        if (event.type === 'content_block_delta') {
          const delta = event.delta as { type?: string; text?: string } | undefined;
          if (delta?.type === 'text_delta' && delta.text) {
            accumulatedContent += delta.text;
            seq++;
            yield makeDeltaEvent(requestId, sessionId, assistantMsgId, seq, delta.text);
            // Update streaming status periodically
            if (seq === 1) {
              updateMessage(assistantMsgId, { status: 'streaming', content: accumulatedContent });
            }
          }
        }
      }

      // Handle assistant message (full message, contains evidence from hooks)
      if (msg.type === 'assistant') {
        const assistantMsg = msg.message;
        // Extract text content blocks
        for (const block of assistantMsg.content) {
          if (block.type === 'text' && 'text' in block) {
            const blockText = (block as { text: string }).text;
            if (blockText && !accumulatedContent.includes(blockText)) {
              accumulatedContent = blockText;
            }
          }
        }
        // Extract evidence from tool_result blocks (from PostToolUse hook)
        for (const block of assistantMsg.content) {
          if (block.type === 'tool_result') {
            const resultBlock = block as { content?: string | Array<{ type: string; text?: string }> };
            const rawContent = typeof resultBlock.content === 'string'
              ? resultBlock.content
              : resultBlock.content?.map((c) => c.text ?? '').join('');
            if (rawContent) {
              try {
                const parsed = JSON.parse(rawContent);
                if (Array.isArray(parsed)) {
                  for (const e of parsed) {
                    if (e && typeof e === 'object' && 'evidenceId' in e) {
                      evidenceList.push(e as Evidence);
                    }
                  }
                }
              } catch {
                // Not JSON or not evidence — skip
              }
            }
          }
        }
      }

      // Handle result (final message with usage)
      if (msg.type === 'result') {
        qoderSessionId = msg.session_id;
        if (msg.subtype === 'success') {
          const usage = msg.usage;
          usageData = {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            costMicrousd: Math.round((msg.total_cost_usd ?? 0) * 1_000_000),
            durationMs: msg.duration_ms ?? (Date.now() - startTime),
          };
          grounding = evidenceList.length > 0 ? 'grounded' : 'inferred';
          completed = true;
        } else {
          // Error result — mark as failed
          const errorMsg = 'errors' in msg ? (msg.errors?.join('; ') ?? 'Query failed') : 'Query failed';
          updateMessage(assistantMsgId, {
            status: 'failed',
            content: accumulatedContent || '',
            errorCode: msg.subtype,
          });
          yield makeErrorEvent(requestId, sessionId, assistantMsgId, 'AGENT_UNAVAILABLE', errorMsg, true);
          return;
        }
      }
    }

    // 7. On success: persist final content + sources + usage
    if (completed && usageData) {
      // Update message with final data
      updateMessage(assistantMsgId, {
        status: 'complete',
        content: accumulatedContent,
        tokenInput: usageData.inputTokens,
        tokenOutput: usageData.outputTokens,
        costMicrousd: usageData.costMicrousd,
        durationMs: usageData.durationMs,
        completedAt: utcNow(),
      });

      // Persist sources
      for (let i = 0; i < evidenceList.length; i++) {
        const ev = evidenceList[i]!;
        createMessageSource(assistantMsgId, i, {
          sourceType: ev.type,
          title: ev.title,
          url: ev.url,
          wikiPath: ev.wikiPath,
          excerpt: ev.excerpt,
          season: ev.season,
          retrievedAt: ev.retrievedAt,
        });

        // Yield source events
        yield makeSourceEvent(requestId, sessionId, assistantMsgId, {
          id: ev.evidenceId,
          ordinal: i,
          type: ev.type,
          title: ev.title,
          wikiPath: ev.wikiPath,
          url: ev.url,
        });
      }

      // Yield usage event
      yield makeUsageEvent(
        requestId,
        sessionId,
        assistantMsgId,
        usageData.inputTokens,
        usageData.outputTokens,
        usageData.durationMs,
      );

      // Yield done event
      yield makeDoneEvent(requestId, sessionId, assistantMsgId, 'complete', grounding);

      // Store qoder_session_id for resume
      if (qoderSessionId) {
        updateQoderSessionId(sessionId, qoderSessionId);
      }

      // 8. First answer → async generate title
      const allMessages = getMessagesBySession(sessionId);
      const assistantCount = allMessages.filter(
        (m) => m.role === 'assistant' && m.status === 'complete',
      ).length;
      if (assistantCount === 1) {
        // Async title generation (non-blocking)
        const title = generateSessionTitle(accumulatedContent);
        // Import here to avoid circular deps
        const { updateSessionTitle } = await import('./repository');
        updateSessionTitle(sessionId, title);
      }
    }
  } catch (err) {
    // 7b. On failure: mark assistant as interrupted/failed
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const status = isAbort ? 'interrupted' : 'failed';
    const errorCode = isAbort ? null : 'AGENT_UNAVAILABLE';

    updateMessage(assistantMsgId, {
      status,
      content: accumulatedContent || '',
      errorCode,
      completedAt: utcNow(),
    });

    if (!isAbort) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      yield makeErrorEvent(requestId, sessionId, assistantMsgId, 'AGENT_UNAVAILABLE', errorMsg, true);
    } else if (accumulatedContent) {
      // Interrupted but has content — yield done with interrupted status
      yield makeDoneEvent(requestId, sessionId, assistantMsgId, 'interrupted', 'inferred');
    }
  } finally {
    // 9. Clean up abort controller
    activeQueries.delete(assistantMsgId);
  }
}

// ---------------------------------------------------------------------------
// Stop message (SPEC §11.3)
// ---------------------------------------------------------------------------

/**
 * Stop generating a message — abort the active query.
 */
export function stopMessage(messageId: string, userId: string): void {
  // Verify the message belongs to user (through session ownership)
  const msg = getMessage(messageId);
  if (!msg) {
    throw new AppError('NOT_FOUND', 'Message not found');
  }

  const controller = activeQueries.get(messageId);
  if (controller) {
    controller.abort();
  }
}

// ---------------------------------------------------------------------------
// Retry message (SPEC §11.3)
// ---------------------------------------------------------------------------

/**
 * Retry a failed/interrupted assistant message.
 * Creates a new assistant message with reply_to_message_id pointing to the same user message.
 */
export async function* retryMessage(
  user: AuthenticatedUser,
  messageId: string,
): AsyncGenerator<SSEEvent> {
  // Find the original assistant message
  const originalMsg = getMessage(messageId);
  if (!originalMsg) {
    throw new AppError('NOT_FOUND', 'Message not found');
  }

  // Find the user message this was replying to
  const replyToId = originalMsg.replyToMessageId;
  if (!replyToId) {
    // This assistant message doesn't have a reply_to — find the preceding user message
    const allMessages = getMessagesBySession(originalMsg.sessionId);
    const msgIndex = allMessages.findIndex((m) => m.id === messageId);
    const precedingUserMsg = allMessages
      .slice(0, msgIndex)
      .reverse()
      .find((m) => m.role === 'user');

    if (!precedingUserMsg) {
      throw new AppError('NOT_FOUND', 'No user message found to retry');
    }

    // Delegate to streamChatMessage with the original user content
    yield* streamChatMessage(user, originalMsg.sessionId, precedingUserMsg.content);
    return;
  }

  // Get the original user message
  const userMsg = getMessage(replyToId);
  if (!userMsg || userMsg.role !== 'user') {
    throw new AppError('NOT_FOUND', 'Original user message not found');
  }

  // Delegate to streamChatMessage
  yield* streamChatMessage(user, originalMsg.sessionId, userMsg.content);
}
