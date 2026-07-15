import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireActiveUser, validateOrigin } from '@/modules/auth/middleware';
import { retryMessage } from '@/modules/chat/service';
import { formatSSEEvent, SSE_HEADERS, type SSEEvent } from '@/modules/chat/sse-events';
import { AppError } from '@/lib/errors';
import { errorResponse } from '@/lib/response';
import { generateId } from '@/lib/uuid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/chat/messages/:id/retry — retry a failed/interrupted message (SSE stream).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireAuth(request);
    requireActiveUser(user);
    validateOrigin(request);

    const { id } = await params;

    const streamAbortController = new AbortController();
    const abortFromRequest = () => streamAbortController.abort();
    request.signal.addEventListener('abort', abortFromRequest, { once: true });
    let generation: AsyncGenerator<SSEEvent> | undefined;
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          generation = retryMessage(user, id, streamAbortController.signal);
          for await (const event of generation) {
            const eventType = getEventType(event);
            const formatted = formatSSEEvent(eventType, event);
            controller.enqueue(encoder.encode(formatted));
          }
        } catch (err) {
          const errorData = createSSEErrorData(err);
          controller.enqueue(encoder.encode(formatSSEEvent('error', errorData)));
        } finally {
          request.signal.removeEventListener('abort', abortFromRequest);
          controller.close();
        }
      },
      cancel() {
        streamAbortController.abort();
        void generation?.return(undefined).catch(() => undefined);
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json(errorResponse(err), { status: err.httpStatus });
    }
    console.error('[API] chat retry request failed', {
      errorClass: err instanceof Error ? err.name : typeof err,
    });
    const internalError = new AppError('SERVICE_NOT_READY', '服务内部错误');
    return NextResponse.json(errorResponse(internalError), { status: 500 });
  }
}

function getEventType(event: SSEEvent): string {
  if ('seq' in event && 'text' in event) return 'delta';
  if ('source' in event) return 'source';
  if ('inputTokens' in event) return 'usage';
  if ('status' in event && 'grounding' in event) return 'done';
  if ('code' in event && 'retryable' in event) return 'error';
  return 'start';
}

function createSSEErrorData(err: unknown): SSEEvent {
  const isBusy = err instanceof AppError && err.code === 'SESSION_BUSY';
  return {
    requestId: generateId(),
    sessionId: '',
    messageId: '',
    timestamp: new Date().toISOString(),
    code: isBusy ? 'SESSION_BUSY' : 'AGENT_UNAVAILABLE',
    message: isBusy ? '该会话正在生成回答，请稍后重试' : '服务暂时不可用，请重试',
    retryable: !isBusy,
  };
}
