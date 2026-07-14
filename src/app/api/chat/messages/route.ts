import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireActiveUser, validateOrigin } from '@/modules/auth/middleware';
import { streamChatMessage } from '@/modules/chat/service';
import { formatSSEEvent, SSE_HEADERS, type SSEEvent } from '@/modules/chat/sse-events';
import { AppError } from '@/lib/errors';
import { errorResponse } from '@/lib/response';
import { generateId } from '@/lib/uuid';
import { MAX_CHAT_ATTACHMENTS } from '@/modules/chat/attachment-input';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/chat/messages — create a message and stream SSE response.
 *
 * This is the primary streaming endpoint. Pre-stream errors (auth, validation)
 * return JSON; in-stream errors are sent as SSE error events.
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const user = await requireAuth(request);
    requireActiveUser(user);
    validateOrigin(request);

    const body = await request.json();

    // Validate required fields
    if (!body.sessionId || typeof body.sessionId !== 'string') {
      throw new AppError('VALIDATION_ERROR', 'sessionId 是必填字段');
    }
    if (typeof body.content !== 'string' || body.content.length < 1 || body.content.length > 8000) {
      throw new AppError('VALIDATION_ERROR', '消息内容必须为 1-8000 个字符');
    }
    if (body.attachmentIds) {
      if (!Array.isArray(body.attachmentIds)) {
        throw new AppError('VALIDATION_ERROR', 'attachmentIds 必须为数组');
      }
      if (
        body.attachmentIds.length > MAX_CHAT_ATTACHMENTS ||
        body.attachmentIds.some((id: unknown) => typeof id !== 'string' || id.length === 0) ||
        new Set(body.attachmentIds).size !== body.attachmentIds.length
      ) {
        throw new AppError(
          'VALIDATION_ERROR',
          `attachmentIds 必须是最多 ${MAX_CHAT_ATTACHMENTS} 个不重复的非空字符串`,
        );
      }
    }

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const event of streamChatMessage(
            user,
            body.sessionId,
            body.content,
            body.attachmentIds,
          )) {
            // Determine event type from the event data
            const eventType = getEventType(event);
            const formatted = formatSSEEvent(eventType, event);
            controller.enqueue(encoder.encode(formatted));
          }
        } catch (err) {
          const errorData = createSSEErrorData(err);
          controller.enqueue(encoder.encode(formatSSEEvent('error', errorData)));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json(errorResponse(err), { status: err.httpStatus });
    }
    console.error('[API] Unexpected error in POST /api/chat/messages:', err);
    const internalError = new AppError('SERVICE_NOT_READY', '服务内部错误');
    return NextResponse.json(errorResponse(internalError), { status: 500 });
  }
}

/**
 * Determine the SSE event type string from the event data.
 */
function getEventType(event: SSEEvent): string {
  if ('seq' in event && 'text' in event) return 'delta';
  if ('stage' in event) return 'status';
  if ('toolUseId' in event) return 'tool';
  if ('source' in event) return 'source';
  if ('inputTokens' in event) return 'usage';
  if ('status' in event && 'grounding' in event) return 'done';
  if ('code' in event && 'retryable' in event) return 'error';
  return 'start';
}

/**
 * Create an SSE error data object from an error.
 */
function createSSEErrorData(err: unknown): any {
  const message = err instanceof Error ? err.message : 'Unknown error';
  return {
    requestId: generateId(),
    sessionId: '',
    messageId: '',
    timestamp: new Date().toISOString(),
    code: 'AGENT_UNAVAILABLE',
    message,
    retryable: true,
  };
}
