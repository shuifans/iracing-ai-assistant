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
import { streamLlmDirect, isLlmDirectConfigured, type LlmChatMessage } from '@/modules/agent/llm-client';
import { CHAT_ANSWER_BACKENDS, type ChatAnswerBackend } from '@/config/constants';
import { CHAT_SYSTEM_PROMPT } from '@/modules/agent/prompts';
import { searchWiki } from '@/modules/knowledge/search-index';
import {
  getCachedAnswer,
  setCachedAnswer,
  getCachedRetrieval,
  setCachedRetrieval,
  makeCacheKey,
  type RetrievalPayload,
} from '@/modules/chat/cache';
import { getDb } from '@/db/client';
import { usageEvents } from '@/db/schema/admin';
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

/**
 * Resolve the chat answer backend (SPEC §11.1):
 * - 'llm-direct' (default): BM25 本地检索 + OpenAI 兼容 LLM 直调 (当前 LongCat-2.0)
 * - 'qoder-sdk'           : Qoder Agent SDK 全量循环 (Qwen3.7-Plus, wiki-search + web-research 子 Agent)
 * 经 `CHAT_ANSWER_BACKEND` 切换;改值后重启生效。
 */
function getChatAnswerBackend(): ChatAnswerBackend {
  const raw = process.env.CHAT_ANSWER_BACKEND;
  return CHAT_ANSWER_BACKENDS.includes(raw as ChatAnswerBackend)
    ? (raw as ChatAnswerBackend)
    : 'llm-direct';
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
  return { requestId, sessionId, messageId, timestamp: utcNow(), status, grounding, timing, workflow };
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

  // Validate attachments exist
  if (attachmentIds?.length) {
    for (const aid of attachmentIds) {
      const att = getAttachment(aid);
      if (!att) {
        throw new AppError('NOT_FOUND', `Attachment ${aid} not found`);
      }
    }
  }
  timing.authMs = Math.round(performance.now() - t0);

  // 2. Short transaction: create user message + pending assistant message
  const t1 = performance.now();
  const userMessage = createMessage(sessionId, 'user', content, 'complete');
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
  // Budget timeout (30s local / 60s web) — hoisted so finally can clear
  let budgetTimeout: ReturnType<typeof setTimeout> | undefined;
  let modelUsed = 'Qwen3.7-Plus';

  try {
    // 4. Config + cache key
    const config = getAgentConfig();
    modelUsed = config.model ?? 'Qwen3.7-Plus';

    // 4a. Answer cache check (skip LLM entirely on hit)
    yield makeStatusEvent(requestId, sessionId, assistantMsgId, 'cache_check', '检查缓存…');
    const recentMsgIds = getMessagesBySession(sessionId)
      .filter((m) => (m.role === 'user' && m.id !== userMessage.id) || (m.role === 'assistant' && m.status === 'complete'))
      .slice(-3)
      .map((m) => m.id);
    const cacheKey = makeCacheKey(content, recentMsgIds);
    const cached = getCachedAnswer(cacheKey);

    if (cached) {
      // === CACHE HIT: replay as SSE deltas (streaming-compatible) ===
      timing.agentFirstByteMs = Math.round(performance.now() - t0);
      const chunks = cached.content.match(/[\s\S]{1,48}/g) ?? [cached.content];
      for (const c of chunks) {
        accumulatedContent += c;
        seq++;
        yield makeDeltaEvent(requestId, sessionId, assistantMsgId, seq, c);
      }
      for (const s of cached.sources) {
        evidenceList.push({
          evidenceId: generateId(),
          type: s.sourceType as Evidence['type'],
          title: s.title,
          url: s.url ?? undefined,
          wikiPath: s.wikiPath ?? undefined,
          excerpt: s.excerpt ?? '',
          season: s.season ?? undefined,
          retrievedAt: utcNow(),
        });
      }
      grounding = cached.grounding;
      usageData = { inputTokens: 0, outputTokens: 0, costMicrousd: 0, durationMs: Math.round(performance.now() - t0) };
      workflow.subAgents = ['cache'];
      cacheUsage = { cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
      completed = true;
      console.log(`[ChatTiming] req=${requestId} CACHE HIT`);
    } else {
      // === cache MISS: dispatch by answer backend ===
      // 'llm-direct' (默认): BM25 本地检索 + LLM 直调, 未命中降级 SDK
      // 'qoder-sdk'         : Qoder SDK 全量循环 (wiki-search + web-research 子 Agent)
      const backend = getChatAnswerBackend();
      const LOCAL_THRESHOLD = Number(process.env.LOCAL_SEARCH_THRESHOLD ?? 0.5);
      let searchResults: Array<{
        evidenceId: string; title: string; wikiPath?: string;
        excerpt: string; season?: string; score: number; retrievedAt?: string;
      }> = [];
      let topScore = 0;
      let retrievalKey = '';
      let cachedRetrieval: RetrievalPayload | null | undefined;
      if (backend === 'llm-direct') {
        // 5. Local BM25 search (no LLM — instant)
        yield makeStatusEvent(requestId, sessionId, assistantMsgId, 'local_search', '检索本地知识库…');
        retrievalKey = makeCacheKey(content, []);
        const t2 = performance.now();
        cachedRetrieval = getCachedRetrieval(retrievalKey);
        searchResults = cachedRetrieval
          ? cachedRetrieval.chunks.map((c) => ({ ...c, retrievedAt: utcNow() }))
          : searchWiki(content, 5).map((r) => ({ ...r }));
        timing.loadAgentContextMs = Math.round(performance.now() - t2);
        topScore = searchResults[0]?.score ?? 0;
        console.log(
          `[ChatTiming] req=${requestId} session=${sessionId} ` +
          `auth=${timing.authMs}ms search=${timing.loadAgentContextMs}ms ` +
          `topScore=${topScore} hits=${searchResults.length}`,
        );
      } else {
        console.log(`[ChatTiming] req=${requestId} QODER_SDK backend budget=${config.chatTimeoutMs}ms`);
      }

      if (backend === 'llm-direct' && searchResults.length > 0 && topScore >= LOCAL_THRESHOLD && isLlmDirectConfigured()) {
        // === LOCAL PATH: LLM direct (30s budget) ===
        for (const r of searchResults) {
          evidenceList.push({
            evidenceId: r.evidenceId,
            type: 'wiki',
            title: r.title,
            wikiPath: r.wikiPath,
            excerpt: r.excerpt,
            season: r.season,
            retrievedAt: r.retrievedAt ?? utcNow(),
          });
        }
        if (!cachedRetrieval) {
          setCachedRetrieval(retrievalKey, content, {
            chunks: searchResults.map((r) => ({
              evidenceId: r.evidenceId, title: r.title, wikiPath: r.wikiPath ?? '',
              excerpt: r.excerpt, season: r.season, score: r.score,
            })),
          });
        }
        yield makeStatusEvent(requestId, sessionId, assistantMsgId, 'generating', '生成回答中…');
        modelUsed = process.env.LLM_MODEL ?? process.env.LONGCAT_MODEL ?? 'LongCat-2.0';
        budgetTimeout = setTimeout(() => abortController.abort(), 30_000);
        t4 = performance.now();
        let firstByte = false;
        try {
          const histMsgs: LlmChatMessage[] = getMessagesBySession(sessionId)
            .filter((m) => (m.role === 'user' && m.id !== userMessage.id) || (m.role === 'assistant' && m.status === 'complete'))
            .slice(-6)
            .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content || '' }));
          for await (const chunk of streamLlmDirect({
            systemPrompt: CHAT_SYSTEM_PROMPT,
            evidence: evidenceList,
            history: histMsgs,
            userMessage: content,
            signal: abortController.signal,
          })) {
            if (chunk.text) {
              if (!firstByte) {
                timing.agentFirstByteMs = Math.round(performance.now() - t4);
                firstByte = true;
              }
              accumulatedContent += chunk.text;
              seq++;
              if (seq === 1) updateMessage(assistantMsgId, { status: 'streaming', content: accumulatedContent });
              yield makeDeltaEvent(requestId, sessionId, assistantMsgId, seq, chunk.text);
            }
            if (chunk.usage) {
              usageData = {
                inputTokens: chunk.usage.inputTokens,
                outputTokens: chunk.usage.outputTokens,
                costMicrousd: 0,
                durationMs: Math.round(performance.now() - t4),
              };
              resultTelemetry = {
                numTurns: 1,
                durationApiMs: Math.round(performance.now() - t4),
                stopReason: 'end_turn',
              };
            }
          }
          grounding = evidenceList.length > 0 ? 'grounded' : 'inferred';
          if (!usageData) {
            usageData = { inputTokens: 0, outputTokens: 0, costMicrousd: 0, durationMs: Math.round(performance.now() - t4) };
          }
          completed = true;
        } catch (err) {
          // 30s budget abort — return partial content as a complete answer (better than ✗)
          if (abortController.signal.aborted || (err as Error).name === 'AbortError') {
            grounding = evidenceList.length > 0 ? 'grounded' : 'inferred';
            usageData = usageData ?? { inputTokens: 0, outputTokens: 0, costMicrousd: 0, durationMs: 30_000 };
            completed = accumulatedContent.length > 0;
            console.log(`[ChatTiming] req=${requestId} LOCAL ABORT (30s budget) partial=${accumulatedContent.length}chars`);
          } else {
            throw err;
          }
        } finally {
          if (budgetTimeout) { clearTimeout(budgetTimeout); budgetTimeout = undefined; }
        }
      } else {
        // === QODER SDK (qoder-sdk 主路径 OR llm-direct 本地未命中降级) ===
        const sdkBudget = backend === 'qoder-sdk' ? config.chatTimeoutMs : 60_000;
        const sdkStage: SSEStatusEvent['stage'] = backend === 'qoder-sdk' ? 'generating' : 'web_fallback';
        const sdkStatusMsg = backend === 'qoder-sdk' ? '生成回答中…' : '本地未命中,联网检索中(预计较久)…';
        yield makeStatusEvent(requestId, sessionId, assistantMsgId, sdkStage, sdkStatusMsg);
        budgetTimeout = setTimeout(() => abortController.abort(), sdkBudget);
        const query = createChatQuery(config, {
          userMessage: content,
          sessionId,
          qoderSessionId: session.qoderSessionId ?? undefined,
          abortController,
        });
        console.log(`[ChatTiming] req=${requestId} SDK backend budget=${sdkBudget}ms stage=${sdkStage} topScore=${topScore}`);

    // 6. Iterate SDK message stream
    let firstDeltaLogged = false;
    t4 = performance.now();
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
            const resultBlock = block as {
              content?: string | Array<{ type: string; text?: string }>;
            };
            const rawContent =
              typeof resultBlock.content === 'string'
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
        // Extract tool_use blocks → yield tool events + accumulate workflow
        // (parent_tool_use_id non-null => this assistant msg is a sub-agent reply)
        const isSubAgentReply = (msg as { parent_tool_use_id?: string | null }).parent_tool_use_id != null;
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
              yield makeToolEvent(requestId, sessionId, assistantMsgId, {
                toolUseId: tu.id ?? generateId(),
                name: toolName,
                isSubAgent: isAgent,
                agentName,
                inputPreview,
              });
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
              typeof (usage as { context_usage_ratio?: number }).context_usage_ratio === 'number'
                ? (usage as { context_usage_ratio?: number }).context_usage_ratio
                : undefined,
          };
          // Capture result telemetry
          const serverToolUse = (usage as { server_tool_use?: { web_fetch_requests?: number; web_search_requests?: number } }).server_tool_use;
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
          // Error result — mark as failed
          const errorMsg =
            'errors' in msg ? (msg.errors?.join('; ') ?? 'Query failed') : 'Query failed';
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
            model: config.model,
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
        if (budgetTimeout) { clearTimeout(budgetTimeout); budgetTimeout = undefined; }
      } // end web-fallback else
    } // end search-else

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

      // Quality-gate answer caching (skip if this was itself a cache hit)
      if (workflow.subAgents[0] !== 'cache' && (grounding === 'grounded' || accumulatedContent.length > 200)) {
        const cachedSources = evidenceList.map((e) => ({
          sourceType: e.type,
          title: e.title,
          url: e.url ?? null,
          wikiPath: e.wikiPath ?? null,
          excerpt: e.excerpt ?? null,
          season: e.season ?? null,
        }));
        setCachedAnswer(cacheKey, content, { content: accumulatedContent, sources: cachedSources, grounding });
      }

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
