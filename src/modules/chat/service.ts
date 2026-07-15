/**
 * Chat service — core streaming orchestration.
 *
 * SPEC §11.1 — send message flow:
 * 1. Validate user active, session ownership, message length
 * 2. Short transaction: write user message + pending assistant message
 * 3. Return SSE start within 500ms
 * 4. Start one Qoder Query with only the current user turn
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

import { join } from 'node:path';
import type { AuthenticatedUser } from '@/modules/auth/types';
import type { SDKMessage } from '@qoder-ai/qoder-agent-sdk';
import { parseEvidenceEnvelope, type AgentConfig } from '@/modules/agent/types';
import { createChatQuery } from '@/modules/agent/client';
import { listEnabledWebSourceRules } from '@/modules/web-sources/service';
import { getDb } from '@/db/client';
import { usageEvents } from '@/db/schema/admin';
import { AppError } from '@/lib/errors';
import { checkRateLimit } from '@/modules/rate-limit/service';
import { generateId } from '@/lib/uuid';
import { utcNow } from '@/lib/datetime';
import {
  createMessage,
  updateMessage,
  getMessage,
  getMessageForUser,
  getMessagesBySession,
  getSession,
  createMessageSource,
  updateQoderSessionId,
  createUserMessageWithAttachments,
  getAttachmentsByMessage,
} from './repository';
import { assertAttachmentBackendSupported, loadAttachmentImages } from './attachment-input';
import { generateSessionTitle } from './session-context';
import type {
  SSEEvent,
  SSEStartEvent,
  SSEDeltaEvent,
  SSESourceEvent,
  SSEToolEvent,
  SSEStatusEvent,
  SSEUsageEvent,
  SSEDoneEvent,
  SSEErrorEvent,
  SSEWorkflow,
  SSEModelUsage,
  PipelineTiming,
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

function resolveWebSourcesSnapshotPath(): string {
  return (
    process.env.WEB_KNOWLEDGE_SOURCES_SNAPSHOT_PATH ??
    join(process.cwd(), 'notes/knowledge-sources.md')
  );
}

function isRecoverableResumeError(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return false;
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const errors = Array.isArray(record.errors) ? record.errors.join(' ') : '';
  const text = [record.subtype, record.name, record.message, errors, String(error)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const normalized = text.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (
    /auth|unauthorized|forbidden|credential|api key/.test(normalized) ||
    /model/.test(normalized) ||
    /timeout|timed out|abort|cancel/.test(normalized)
  ) {
    return false;
  }
  return /(?:resume|session)/.test(normalized) && /(?:not found|invalid|expired)/.test(normalized);
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
  source: {
    id: string;
    ordinal: number;
    type: string;
    title: string;
    wikiPath?: string;
    url?: string;
  },
): SSESourceEvent {
  return { requestId, sessionId, messageId, timestamp: utcNow(), source };
}

function makeToolEvent(
  requestId: string,
  sessionId: string,
  messageId: string,
  tool: {
    toolUseId: string;
    name: string;
    isSubAgent: boolean;
    agentName?: string;
    inputPreview?: string;
  },
): SSEToolEvent {
  return { requestId, sessionId, messageId, timestamp: utcNow(), ...tool };
}

function makeStatusEvent(
  requestId: string,
  sessionId: string,
  messageId: string,
  stage: SSEStatusEvent['stage'],
  message: string,
): SSEStatusEvent {
  return { requestId, sessionId, messageId, timestamp: utcNow(), stage, message };
}

interface UsageExtras {
  timing?: PipelineTiming;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  cacheHit?: boolean;
  contextUsageRatio?: number;
  numTurns?: number;
  durationApiMs?: number;
  stopReason?: string | null;
  serverToolUse?: { webFetchRequests: number; webSearchRequests: number };
  modelUsage?: Record<string, SSEModelUsage>;
}

function makeUsageEvent(
  requestId: string,
  sessionId: string,
  messageId: string,
  inputTokens: number,
  outputTokens: number,
  durationMs: number,
  extras: UsageExtras = {},
): SSEUsageEvent {
  return {
    requestId,
    sessionId,
    messageId,
    timestamp: utcNow(),
    inputTokens,
    outputTokens,
    durationMs,
    ...extras,
  };
}

function makeDoneEvent(
  requestId: string,
  sessionId: string,
  messageId: string,
  status: 'complete' | 'interrupted',
  grounding: 'grounded' | 'inferred' | 'insufficient',
  timing?: PipelineTiming,
  workflow?: SSEWorkflow,
): SSEDoneEvent {
  return {
    requestId,
    sessionId,
    messageId,
    timestamp: utcNow(),
    status,
    grounding,
    timing,
    workflow,
  };
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
// Usage event recording (fire-and-forget)
// ---------------------------------------------------------------------------

function recordUsageEvent(params: {
  userId: string;
  sessionId: string;
  eventType: string;
  model?: string;
  tokenInput?: number;
  tokenOutput?: number;
  costMicroUsd?: number;
  durationMs?: number;
  result: string;
  knowledgeHit?: boolean;
}): void {
  try {
    const db = getDb();
    db.insert(usageEvents)
      .values({
        id: generateId(),
        userId: params.userId,
        sessionId: params.sessionId,
        eventType: params.eventType,
        model: params.model ?? null,
        tokenInput: params.tokenInput ?? 0,
        tokenOutput: params.tokenOutput ?? 0,
        costMicrousd: params.costMicroUsd ?? 0,
        durationMs: params.durationMs ?? 0,
        result: params.result,
        knowledgeHit: params.knowledgeHit ? 'true' : 'false',
        createdAt: utcNow(),
      })
      .run();
  } catch {
    // fire-and-forget: usage recording must not break the main flow
  }
}

// ---------------------------------------------------------------------------
// Model usage mapper (SDK ModelUsage → SSEModelUsage)
// ---------------------------------------------------------------------------

/** Map the SDK's per-model usage record to the SSE wire shape. */
function buildModelUsage(
  modelUsage: Record<string, unknown> | undefined,
): Record<string, SSEModelUsage> | undefined {
  if (!modelUsage || typeof modelUsage !== 'object') return undefined;
  const out: Record<string, SSEModelUsage> = {};
  for (const [model, raw] of Object.entries(modelUsage)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, number>;
    out[model] = {
      cacheReadInputTokens: r.cacheReadInputTokens ?? 0,
      cacheCreationInputTokens: r.cacheCreationInputTokens ?? 0,
      costUsd: r.costUSD ?? 0,
      contextWindow: r.contextWindow ?? 0,
    };
  }
  return Object.keys(out).length ? out : undefined;
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
  const t0 = performance.now();
  const timing: Partial<PipelineTiming> = {};

  // 1. Validate session ownership
  const session = getSession(sessionId, user.id);
  if (!session) {
    throw new AppError('NOT_FOUND', 'Session not found or access denied');
  }

  assertAttachmentBackendSupported('qoder-sdk', Boolean(attachmentIds?.length));

  checkRateLimit(user.id, user.role);
  timing.authMs = Math.round(performance.now() - t0);

  // 2. Short transaction: create user message + pending assistant message
  const t1 = performance.now();
  const userMessage = attachmentIds?.length
    ? createUserMessageWithAttachments(sessionId, user.id, content, attachmentIds)
    : createMessage(sessionId, 'user', content, 'complete');
  const imageAttachments = attachmentIds?.length
    ? await loadAttachmentImages(getAttachmentsByMessage(userMessage.id))
    : [];
  const assistantMessage = createMessage(sessionId, 'assistant', '', 'pending');
  const assistantMsgId = assistantMessage.id;

  // 3. Yield start event
  yield makeStartEvent(requestId, sessionId, assistantMsgId);

  // Track accumulated content and evidence
  let accumulatedContent = '';
  let seq = 0;
  const evidenceList: Evidence[] = [];
  // Workflow / cache telemetry accumulators
  const workflow: SSEWorkflow = {
    subAgents: [],
    toolCallCount: 0,
    compacted: false,
    retries: 0,
  };
  let cacheUsage: {
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    contextUsageRatio?: number;
  } | null = null;
  let resultTelemetry: {
    numTurns?: number;
    durationApiMs?: number;
    stopReason?: string | null;
    serverToolUse?: { webFetchRequests: number; webSearchRequests: number };
    modelUsage?: Record<string, SSEModelUsage>;
  } = {};
  let qoderSessionId: string | undefined;
  let usageData: {
    inputTokens: number;
    outputTokens: number;
    costMicrousd: number;
    durationMs: number;
  } | null = null;
  let grounding: 'grounded' | 'inferred' | 'insufficient' = 'inferred';
  let completed = false;
  const startTime = Date.now();

  // Set up abort controller
  const abortController = new AbortController();
  activeQueries.set(assistantMsgId, abortController);

  // Timing markers — hoisted so catch block can reference them
  let t4 = performance.now();
  // Fixed 120s Agent budget — hoisted so finally can clear.
  let budgetTimeout: ReturnType<typeof setTimeout> | undefined;
  let modelUsed = 'Qwen3.7-Plus';

  try {
    // 4. Start one direct Qoder Agent query for the current turn only.
    const config = getAgentConfig();
    modelUsed = 'Qwen3.7-Plus';
    yield makeStatusEvent(requestId, sessionId, assistantMsgId, 'generating', '生成回答中…');
    budgetTimeout = setTimeout(() => abortController.abort(), 120_000);
    let resumeSessionId = session.qoderSessionId ?? undefined;
    t4 = performance.now();

    queryAttempts: for (let attempt = 0; attempt < 2; attempt++) {
      let retryWithoutResume = false;
      let firstDeltaLogged = false;
      let visibleOutputCommitted = false;
      let query: AsyncGenerator<SDKMessage>;
      try {
        query = createChatQuery(config, {
          userMessage: content,
          sessionId,
          qoderSessionId: resumeSessionId,
          webSearchEnabled: session.webSearchEnabled,
          imageAttachments,
          abortController,
          webSourcesSnapshotPath: resolveWebSourcesSnapshotPath(),
          loadWebSourceRules: listEnabledWebSourceRules,
          onEvidence: (evidence) => {
            if (!evidenceList.some((item) => item.evidenceId === evidence.evidenceId)) {
              evidenceList.push(evidence);
            }
          },
        });
        console.log(
          `[ChatTiming] req=${requestId} QODER_SDK budget=120000ms web=${session.webSearchEnabled}`,
        );

        // 5. Iterate SDK message stream.
        for await (const sdkMsg of query) {
          if (!firstDeltaLogged) {
            timing.agentFirstByteMs = Math.round(performance.now() - t4);
            firstDeltaLogged = true;
            console.log(
              `[ChatTiming] req=${requestId} agentFirstByte=${timing.agentFirstByteMs}ms`,
            );
          }

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
                const deltaEvent = makeDeltaEvent(
                  requestId,
                  sessionId,
                  assistantMsgId,
                  seq,
                  delta.text,
                );
                visibleOutputCommitted = true;
                yield deltaEvent;
                // Update streaming status periodically
                if (seq === 1) {
                  updateMessage(assistantMsgId, {
                    status: 'streaming',
                    content: accumulatedContent,
                  });
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
                const resultBlock = block as {
                  content?: string | Array<{ type: string; text?: string }>;
                };
                const rawContent =
                  typeof resultBlock.content === 'string'
                    ? resultBlock.content
                    : resultBlock.content?.map((c) => c.text ?? '').join('');
                if (rawContent) {
                  const envelope = parseEvidenceEnvelope(rawContent);
                  if (envelope) {
                    for (const evidence of envelope.evidence) {
                      if (!evidenceList.some((item) => item.evidenceId === evidence.evidenceId)) {
                        evidenceList.push(evidence);
                      }
                    }
                  }
                }
              }
            }
            // Extract tool_use blocks → yield tool events + accumulate workflow
            // (parent_tool_use_id non-null => this assistant msg is a sub-agent reply)
            const isSubAgentReply =
              (msg as { parent_tool_use_id?: string | null }).parent_tool_use_id != null;
            for (const block of assistantMsg.content) {
              if (block.type === 'tool_use') {
                const tu = block as {
                  id?: string;
                  name?: string;
                  input?: { agent?: string; prompt?: string; [k: string]: unknown };
                };
                const toolName = tu.name ?? 'unknown';
                const isAgent = toolName === 'Agent';
                const agentName = isAgent ? tu.input?.agent : undefined;
                workflow.toolCallCount++;
                if (isAgent && agentName && !workflow.subAgents.includes(agentName)) {
                  workflow.subAgents.push(agentName);
                }
                // Don't emit tool events for sub-agent-internal turns (too noisy);
                // only surface top-level tool calls the main agent makes.
                if (!isSubAgentReply) {
                  const inputPreview = JSON.stringify(tu.input ?? {}).slice(0, 200);
                  const toolEvent = makeToolEvent(requestId, sessionId, assistantMsgId, {
                    toolUseId: tu.id ?? generateId(),
                    name: toolName,
                    isSubAgent: isAgent,
                    agentName,
                    inputPreview,
                  });
                  visibleOutputCommitted = true;
                  yield toolEvent;
                }
              }
            }
          }

          // Handle system messages: compaction, retries, task lifecycle
          if (msg.type === 'system') {
            const sysMsg = msg as {
              subtype?: string;
              status?: string | null;
              compact_metadata?: {
                pre_tokens?: number;
                post_tokens?: number;
                messages_summarized?: number;
              };
              attempt?: number;
            };
            if (sysMsg.subtype === 'compact_boundary' || sysMsg.status === 'compacting') {
              workflow.compacted = true;
              if (sysMsg.compact_metadata) {
                workflow.compactMetadata = {
                  preTokens: sysMsg.compact_metadata.pre_tokens,
                  postTokens: sysMsg.compact_metadata.post_tokens,
                  messagesSummarized: sysMsg.compact_metadata.messages_summarized,
                };
              }
            } else if (sysMsg.subtype === 'api_retry') {
              workflow.retries++;
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
                durationMs: msg.duration_ms ?? Date.now() - startTime,
              };
              // Capture cache telemetry (NonNullableUsage — fields guaranteed present)
              cacheUsage = {
                cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
                cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
                contextUsageRatio:
                  typeof (usage as { context_usage_ratio?: number }).context_usage_ratio ===
                  'number'
                    ? (usage as { context_usage_ratio?: number }).context_usage_ratio
                    : undefined,
              };
              // Capture result telemetry
              const serverToolUse = (
                usage as {
                  server_tool_use?: { web_fetch_requests?: number; web_search_requests?: number };
                }
              ).server_tool_use;
              resultTelemetry = {
                numTurns: msg.num_turns,
                durationApiMs: msg.duration_api_ms,
                stopReason: msg.stop_reason,
                serverToolUse: serverToolUse
                  ? {
                      webFetchRequests: serverToolUse.web_fetch_requests ?? 0,
                      webSearchRequests: serverToolUse.web_search_requests ?? 0,
                    }
                  : undefined,
                modelUsage: buildModelUsage(msg.modelUsage),
              };
              grounding = evidenceList.length > 0 ? 'grounded' : 'inferred';
              completed = true;
            } else {
              const errorMsg =
                'errors' in msg ? (msg.errors?.join('; ') ?? 'Query failed') : 'Query failed';
              if (
                attempt === 0 &&
                resumeSessionId &&
                !visibleOutputCommitted &&
                isRecoverableResumeError(msg, abortController.signal)
              ) {
                retryWithoutResume = true;
                break;
              }

              // Non-resume SDK errors fail normally and are never retried as a new session.
              updateMessage(assistantMsgId, {
                status: 'failed',
                content: accumulatedContent || '',
                errorCode: msg.subtype,
              });
              // Record usage event (error from SDK)
              recordUsageEvent({
                userId: user.id,
                sessionId,
                eventType: 'chat',
                model: 'Qwen3.7-Plus',
                durationMs: Date.now() - startTime,
                result: 'error',
              });

              yield makeErrorEvent(
                requestId,
                sessionId,
                assistantMsgId,
                'AGENT_UNAVAILABLE',
                errorMsg,
                true,
              );
              return;
            }
          }
        }
      } catch (error) {
        if (
          attempt === 0 &&
          resumeSessionId &&
          !visibleOutputCommitted &&
          isRecoverableResumeError(error, abortController.signal)
        ) {
          retryWithoutResume = true;
        } else {
          throw error;
        }
      }

      if (retryWithoutResume) {
        accumulatedContent = '';
        seq = 0;
        evidenceList.length = 0;
        workflow.subAgents = [];
        workflow.toolCallCount = 0;
        workflow.compacted = false;
        workflow.retries = 0;
        workflow.compactMetadata = undefined;
        cacheUsage = null;
        resultTelemetry = {};
        qoderSessionId = undefined;
        usageData = null;
        grounding = 'inferred';
        completed = false;
        timing.agentFirstByteMs = undefined;
        updateQoderSessionId(sessionId, null);
        resumeSessionId = undefined;
        workflow.retries++;
        t4 = performance.now();
        continue queryAttempts;
      }
      break;
    }
    if (budgetTimeout) {
      clearTimeout(budgetTimeout);
      budgetTimeout = undefined;
    }

    // 7. On success: persist final content + sources + usage
    if (completed && usageData) {
      timing.agentStreamMs = Math.round(performance.now() - t4);

      // Update message with final data
      const t5 = performance.now();
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
      timing.saveMessageMs = Math.round(performance.now() - t5);
      timing.totalMs = Math.round(performance.now() - t0);

      // Build final timing object
      const finalTiming: PipelineTiming = {
        authMs: timing.authMs ?? 0,
        loadAgentContextMs: timing.loadAgentContextMs ?? 0,
        agentConnectMs: 0, // SDK doesn't expose connect separately
        agentFirstByteMs: timing.agentFirstByteMs ?? 0,
        agentStreamMs: timing.agentStreamMs ?? 0,
        saveMessageMs: timing.saveMessageMs ?? 0,
        totalMs: timing.totalMs ?? 0,
      };

      console.log(
        `[ChatTiming] req=${requestId} DONE ` +
          `firstByte=${finalTiming.agentFirstByteMs}ms ` +
          `stream=${finalTiming.agentStreamMs}ms ` +
          `save=${finalTiming.saveMessageMs}ms ` +
          `total=${finalTiming.totalMs}ms`,
      );

      // Yield usage event (with cache + workflow telemetry)
      yield makeUsageEvent(
        requestId,
        sessionId,
        assistantMsgId,
        usageData.inputTokens,
        usageData.outputTokens,
        usageData.durationMs,
        {
          timing: finalTiming,
          cacheCreationInputTokens: cacheUsage?.cacheCreationInputTokens,
          cacheReadInputTokens: cacheUsage?.cacheReadInputTokens,
          cacheHit: cacheUsage ? cacheUsage.cacheReadInputTokens > 0 : undefined,
          contextUsageRatio: cacheUsage?.contextUsageRatio,
          numTurns: resultTelemetry.numTurns,
          durationApiMs: resultTelemetry.durationApiMs,
          stopReason: resultTelemetry.stopReason,
          serverToolUse: resultTelemetry.serverToolUse,
          modelUsage: resultTelemetry.modelUsage,
        },
      );

      // Yield done event (with workflow summary)
      yield makeDoneEvent(
        requestId,
        sessionId,
        assistantMsgId,
        'complete',
        grounding,
        finalTiming,
        workflow,
      );

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

      // Record usage event (success)
      recordUsageEvent({
        userId: user.id,
        sessionId,
        eventType: 'chat',
        model: modelUsed,
        tokenInput: usageData.inputTokens,
        tokenOutput: usageData.outputTokens,
        costMicroUsd: usageData.costMicrousd,
        durationMs: usageData.durationMs,
        result: 'success',
        knowledgeHit: evidenceList.length > 0,
      });
    }
  } catch (err) {
    // 7b. On failure: mark assistant as interrupted/failed
    timing.totalMs = Math.round(performance.now() - t0);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const status = isAbort ? 'interrupted' : 'failed';
    const errorCode = isAbort ? null : 'AGENT_UNAVAILABLE';

    console.log(
      `[ChatTiming] req=${requestId} ${isAbort ? 'ABORTED' : 'FAILED'} ` +
        `total=${timing.totalMs}ms firstByte=${timing.agentFirstByteMs ?? 'N/A'}ms ` +
        `error=${err instanceof Error ? err.message : String(err)}`,
    );

    updateMessage(assistantMsgId, {
      status,
      content: accumulatedContent || '',
      errorCode,
      completedAt: utcNow(),
    });

    // Record usage event (exception)
    recordUsageEvent({
      userId: user.id,
      sessionId,
      eventType: 'chat',
      durationMs: Date.now() - startTime,
      result: 'error',
    });

    if (!isAbort) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      yield makeErrorEvent(
        requestId,
        sessionId,
        assistantMsgId,
        'AGENT_UNAVAILABLE',
        errorMsg,
        true,
      );
    } else if (accumulatedContent) {
      // Interrupted but has content — yield done with interrupted status
      const partialTiming: PipelineTiming = {
        authMs: timing.authMs ?? 0,
        loadAgentContextMs: timing.loadAgentContextMs ?? 0,
        agentConnectMs: 0,
        agentFirstByteMs: timing.agentFirstByteMs ?? 0,
        agentStreamMs: Math.round(performance.now() - t4),
        saveMessageMs: 0,
        totalMs: timing.totalMs ?? 0,
      };
      yield makeDoneEvent(
        requestId,
        sessionId,
        assistantMsgId,
        'interrupted',
        'inferred',
        partialTiming,
        workflow,
      );
    }
  } finally {
    // 9. Clean up abort controller + any pending budget timeout
    if (budgetTimeout) clearTimeout(budgetTimeout);
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
  const msg = getMessageForUser(messageId, userId);
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
