import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireActiveUser } from '@/modules/auth/middleware';
import { streamChatMessage } from '@/modules/chat/service';
import { AppError } from '@/lib/errors';
import { errorResponse } from '@/lib/response';
import type { SSEEvent, PipelineTiming } from '@/modules/chat/sse-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RoundResult {
  round: number;
  question: string;
  success: boolean;
  error?: string;
  errorCode?: string;
  timing?: PipelineTiming;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  responseLength?: number;
  sourceCount?: number;
}

interface DiagnosticSummary {
  totalRounds: number;
  successCount: number;
  failCount: number;
  avgFirstByteMs: number;
  avgTotalMs: number;
  maxTotalMs: number;
  minTotalMs: number;
  totalTokens: number;
}

// ---------------------------------------------------------------------------
// POST /api/chat/diagnostic — run multi-turn diagnostic test
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const user = await requireAuth(request);
    requireActiveUser(user);

    const body = await request.json();
    const questions: string[] = body.questions ?? [
      '如何调整赛车刹车平衡以获得更好的入弯表现？',
      '轮胎压力对圈速有什么影响？应该如何调整？',
      'iRacing 的安全等级是如何计算的？',
    ];
    const sessionId: string | undefined = body.sessionId;
    const maxRounds = Math.min(questions.length, 10);

    // Create or reuse session
    let targetSessionId = sessionId;
    if (!targetSessionId) {
      const { createSession } = await import('@/modules/chat/repository');
      const session = createSession(user.id);
      targetSessionId = session.id;
    }

    const results: RoundResult[] = [];
    const startTime = Date.now();

    for (let i = 0; i < maxRounds; i++) {
      const question = questions[i]!;
      const round: RoundResult = {
        round: i + 1,
        question: question,
        success: false,
      };

      const roundStart = Date.now();

      try {
        // Consume the SSE generator
        let responseText = '';
        let sourceCount = 0;

        for await (const event of streamChatMessage(user, targetSessionId, question)) {
          const evt = event as SSEEvent;

          // Collect timing from done event
          if ('status' in evt && 'grounding' in evt && 'timing' in evt) {
            const doneEvent = evt as { timing?: PipelineTiming; status: string };
            if (doneEvent.timing) {
              round.timing = doneEvent.timing;
            }
          }

          // Collect usage from usage event
          if ('inputTokens' in evt) {
            const usageEvent = evt as { inputTokens: number; outputTokens: number; durationMs: number; timing?: PipelineTiming };
            round.inputTokens = usageEvent.inputTokens;
            round.outputTokens = usageEvent.outputTokens;
            round.durationMs = usageEvent.durationMs;
            if (usageEvent.timing) {
              round.timing = usageEvent.timing;
            }
          }

          // Accumulate text
          if ('text' in evt && 'seq' in evt) {
            const deltaEvent = evt as { text: string };
            responseText += deltaEvent.text;
          }

          // Count sources
          if ('source' in evt) {
            sourceCount++;
          }

          // Handle errors
          if ('code' in evt && 'retryable' in evt) {
            const errorEvent = evt as { code: string; message: string };
            round.error = errorEvent.message;
            round.errorCode = errorEvent.code;
          }
        }

        round.responseLength = responseText.length;
        round.sourceCount = sourceCount;
        round.success = !round.error && responseText.length > 0;

        if (!round.durationMs) {
          round.durationMs = Date.now() - roundStart;
        }
      } catch (err) {
        round.error = err instanceof Error ? err.message : String(err);
        round.durationMs = Date.now() - roundStart;
      }

      results.push(round);

      // Log progress
      console.log(
        `[Diagnostic] Round ${i + 1}/${maxRounds}: ` +
        `${round.success ? 'OK' : 'FAIL'} ` +
        `${round.durationMs}ms ` +
        `firstByte=${round.timing?.agentFirstByteMs ?? '?'}ms ` +
        `total=${round.timing?.totalMs ?? '?'}ms`,
      );
    }

    // Build summary
    const successful = results.filter((r) => r.success);
    const summary: DiagnosticSummary = {
      totalRounds: maxRounds,
      successCount: successful.length,
      failCount: results.length - successful.length,
      avgFirstByteMs: successful.length
        ? Math.round(
            successful.reduce((sum, r) => sum + (r.timing?.agentFirstByteMs ?? 0), 0) /
              successful.length,
          )
        : 0,
      avgTotalMs: successful.length
        ? Math.round(
            successful.reduce((sum, r) => sum + (r.timing?.totalMs ?? r.durationMs ?? 0), 0) /
              successful.length,
          )
        : 0,
      maxTotalMs: Math.max(
        ...results.map((r) => r.timing?.totalMs ?? r.durationMs ?? 0),
        0,
      ),
      minTotalMs: Math.min(
        ...results.filter((r) => r.success).map((r) => r.timing?.totalMs ?? r.durationMs ?? 0),
        0,
      ),
      totalTokens: results.reduce((sum, r) => sum + (r.inputTokens ?? 0) + (r.outputTokens ?? 0), 0),
    };

    return NextResponse.json({
      data: {
        sessionId: targetSessionId,
        rounds: results,
        summary,
        totalDurationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json(errorResponse(err), { status: err.httpStatus });
    }
    console.error('[Diagnostic] Unexpected error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Diagnostic test failed' } },
      { status: 500 },
    );
  }
}
