'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { authFetch, getAccessToken } from '@/lib/auth-client';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { ChatInput } from '@/components/chat/ChatInput';
import type { ChatMessage, MessageSourceData, PipelineTimingDisplay } from '@/modules/chat/types';

interface PipelineTiming {
  authMs: number;
  loadContextMs: number;
  loadAgentContextMs: number;
  agentConnectMs: number;
  agentFirstByteMs: number;
  agentStreamMs: number;
  saveMessageMs: number;
  totalMs: number;
}

interface SSEEventBase {
  requestId: string;
  sessionId: string;
  messageId: string;
  timestamp: string;
}

interface SSEStartEvent extends SSEEventBase {
  /* event: start */
}

interface SSEDeltaEvent extends SSEEventBase {
  seq: number;
  text: string;
}

interface SSESourceEvent extends SSEEventBase {
  source: {
    id: string;
    ordinal: number;
    type: string;
    title: string;
    wikiPath?: string;
    url?: string;
  };
}

interface SSEDoneEvent extends SSEEventBase {
  status: 'complete' | 'interrupted';
  grounding: 'grounded' | 'inferred' | 'insufficient';
  timing?: PipelineTiming;
}

interface SSEStatusEvent extends SSEEventBase {
  stage:
    | 'understanding'
    | 'local_search'
    | 'local_read'
    | 'web_search'
    | 'web_fetch'
    | 'synthesizing'
    | 'complete';
  message: string;
  current?: number;
  limit?: number;
  sourceName?: string;
}

interface SSEErrorEvent extends SSEEventBase {
  code: string;
  message: string;
  retryable: boolean;
}

type SSEEvent =
  SSEStartEvent | SSEDeltaEvent | SSESourceEvent | SSEStatusEvent | SSEDoneEvent | SSEErrorEvent;

export default function SessionPage() {
  const params = useParams<{ sessionId: string }>();
  const router = useRouter();
  const sessionId = params.sessionId;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [statusStage, setStatusStage] = useState<{ stage: string; message: string } | null>(null);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [webSearchUpdating, setWebSearchUpdating] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const webSearchAbortControllerRef = useRef<AbortController | null>(null);
  const webSearchUpdateRef = useRef(false);
  const activeSessionIdRef = useRef(sessionId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamMessageIdRef = useRef<string | null>(null);

  activeSessionIdRef.current = sessionId;

  // 滚动到底部
  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 加载历史消息
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    setLoaded(false);
    setMessages([]);
    setError(null);
    setWebSearchEnabled(false);
    setWebSearchUpdating(false);
    webSearchUpdateRef.current = false;
    webSearchAbortControllerRef.current?.abort();
    webSearchAbortControllerRef.current = null;

    async function loadSession() {
      try {
        const res = await authFetch(`/api/chat/sessions/${sessionId}`, {
          signal: controller.signal,
        });
        if (cancelled) return;
        if (res.status === 404) {
          router.replace('/chat');
          return;
        }
        if (!res.ok) {
          let message = '加载会话失败';
          try {
            const payload = (await res.json()) as { error?: { message?: string } };
            message = payload.error?.message ?? message;
          } catch {
            // 保留通用错误文案
          }
          setError(message);
          return;
        }

        const json = (await res.json()) as {
          data?: {
            session?: { id?: string; webSearchEnabled?: unknown };
            messages?: unknown;
          };
        };
        if (
          json.data?.session?.id !== sessionId ||
          typeof json.data.session.webSearchEnabled !== 'boolean' ||
          !Array.isArray(json.data.messages)
        ) {
          throw new Error('INVALID_SESSION_RESPONSE');
        }
        if (cancelled) return;
        setMessages(json.data.messages as ChatMessage[]);
        setWebSearchEnabled(json.data.session.webSearchEnabled);
        setLoaded(true);
      } catch (loadError) {
        if (!cancelled && (loadError as Error).name !== 'AbortError') {
          setError('加载会话失败');
        }
      }
    }
    loadSession();

    return () => {
      cancelled = true;
      controller.abort();
      webSearchAbortControllerRef.current?.abort();
      webSearchAbortControllerRef.current = null;
      webSearchUpdateRef.current = false;
    };
  }, [sessionId, router]);

  const handleWebSearchChange = useCallback(
    async (enabled: boolean) => {
      if (webSearchUpdateRef.current || !loaded) return;

      const targetSessionId = sessionId;
      const controller = new AbortController();
      webSearchUpdateRef.current = true;
      webSearchAbortControllerRef.current = controller;
      setWebSearchUpdating(true);
      setError(null);

      try {
        const response = await authFetch(`/api/chat/sessions/${targetSessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ webSearchEnabled: enabled }),
          signal: controller.signal,
        });

        if (!response.ok) {
          let message = '保存联网搜索设置失败';
          try {
            const payload = (await response.json()) as { error?: { message?: string } };
            message = payload.error?.message ?? message;
          } catch {
            // 保留通用错误文案
          }
          throw new Error(message);
        }

        const payload = (await response.json()) as {
          data: { id: string; webSearchEnabled: boolean };
        };
        if (
          !controller.signal.aborted &&
          activeSessionIdRef.current === targetSessionId &&
          payload.data.id === targetSessionId
        ) {
          setWebSearchEnabled(payload.data.webSearchEnabled);
        }
      } catch (updateError) {
        if (!controller.signal.aborted && activeSessionIdRef.current === targetSessionId) {
          setError((updateError as Error).message || '保存联网搜索设置失败');
        }
      } finally {
        if (activeSessionIdRef.current === targetSessionId) {
          webSearchUpdateRef.current = false;
          webSearchAbortControllerRef.current = null;
          setWebSearchUpdating(false);
        }
      }
    },
    [loaded, sessionId],
  );

  // 检查 pending message（从新会话页面跳转过来）
  useEffect(() => {
    if (!loaded) return;
    const pending = sessionStorage.getItem(`pending-message-${sessionId}`);
    if (pending) {
      sessionStorage.removeItem(`pending-message-${sessionId}`);
      try {
        const { content, attachmentIds } = JSON.parse(pending) as {
          content: string;
          attachmentIds: string[];
        };
        sendMessage(content, attachmentIds);
      } catch {
        // 忽略解析错误
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // 发送消息并处理 SSE 流
  async function sendMessage(content: string, attachmentIds: string[]) {
    if (isStreaming) return;
    setError(null);
    setStatusStage(null);

    // 添加用户消息到列表
    const userMessage: ChatMessage = {
      id: `temp-user-${Date.now()}`,
      role: 'user',
      status: 'complete',
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // 添加空的 assistant 消息占位
    const assistantPlaceholder: ChatMessage = {
      id: `temp-assistant-${Date.now()}`,
      role: 'assistant',
      status: 'streaming',
      content: '',
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, assistantPlaceholder]);
    setIsStreaming(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const token = getAccessToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          sessionId,
          content,
          attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
        }),
        signal: abortController.signal,
      });

      if (!res.ok || !res.body) {
        let errorMsg = '发送失败，请重试';
        try {
          const json = await res.json();
          errorMsg = (json as { error?: { message?: string } }).error?.message ?? errorMsg;
        } catch {
          // 忽略
        }
        setError(errorMsg);
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantPlaceholder.id ? { ...m, status: 'failed' } : m)),
        );
        setIsStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEventType = '';
      let assistantMessageId = '';
      let accumulatedText = '';
      let terminalReceived = false;
      const sources: MessageSourceData[] = [];
      let capturedTiming: PipelineTimingDisplay | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            try {
              const event = JSON.parse(dataStr) as SSEEvent;

              if (currentEventType === 'start') {
                assistantMessageId = event.messageId;
                streamMessageIdRef.current = assistantMessageId;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantPlaceholder.id ? { ...m, id: assistantMessageId } : m,
                  ),
                );
              } else if (currentEventType === 'delta') {
                const deltaEvent = event as SSEDeltaEvent;
                setStatusStage(null);
                accumulatedText += deltaEvent.text;
                assistantMessageId = event.messageId || assistantMessageId;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === (assistantMessageId || assistantPlaceholder.id)
                      ? { ...m, content: accumulatedText, id: assistantMessageId }
                      : m,
                  ),
                );
              } else if (currentEventType === 'source') {
                const sourceEvent = event as SSESourceEvent;
                const source: MessageSourceData = {
                  id: sourceEvent.source.id,
                  ordinal: sourceEvent.source.ordinal,
                  sourceType: sourceEvent.source.type,
                  title: sourceEvent.source.title,
                  url: sourceEvent.source.url,
                  wikiPath: sourceEvent.source.wikiPath,
                };
                sources.push(source);
              } else if (currentEventType === 'status') {
                const statusEvent = event as SSEStatusEvent;
                setStatusStage({ stage: statusEvent.stage, message: statusEvent.message });
                if (statusEvent.stage === 'complete') setStatusStage(null);
              } else if (currentEventType === 'done') {
                terminalReceived = true;
                const doneEvent = event as SSEDoneEvent;
                setStatusStage(null);
                // Capture timing from done event
                if (doneEvent.timing) {
                  capturedTiming = {
                    agentFirstByteMs: doneEvent.timing.agentFirstByteMs,
                    agentStreamMs: doneEvent.timing.agentStreamMs,
                    totalMs: doneEvent.timing.totalMs,
                  };
                }
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessageId
                      ? {
                          ...m,
                          status: doneEvent.status === 'complete' ? 'complete' : 'interrupted',
                          content: accumulatedText,
                          sources: sources.length > 0 ? sources : undefined,
                          timing: capturedTiming,
                        }
                      : m,
                  ),
                );
              } else if (currentEventType === 'error') {
                terminalReceived = true;
                const errorEvent = event as SSEErrorEvent;
                setError(errorEvent.message);
                setStatusStage(null);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === (assistantMessageId || assistantPlaceholder.id)
                      ? { ...m, status: 'failed', id: assistantMessageId || m.id }
                      : m,
                  ),
                );
              }
            } catch {
              // JSON 解析失败，跳过
            }
          }
        }
      }

      // Transport EOF is never success. Preserve partial text as interrupted;
      // an empty reply is a retryable failed turn.
      if (!terminalReceived && assistantMessageId) {
        if (!accumulatedText) setError('回答流意外中断，请重试');
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId && m.status === 'streaming'
              ? {
                  ...m,
                  status: accumulatedText ? 'interrupted' : 'failed',
                  content: accumulatedText,
                  sources,
                }
              : m,
          ),
        );
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError('网络异常，请重试');
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantPlaceholder.id ? { ...m, status: 'failed' } : m)),
        );
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === (streamMessageIdRef.current || assistantPlaceholder.id) &&
            m.status === 'streaming'
              ? { ...m, status: 'interrupted' }
              : m,
          ),
        );
      }
    } finally {
      setStatusStage(null);
      setIsStreaming(false);
      abortControllerRef.current = null;
      streamMessageIdRef.current = null;
    }
  }

  // 停止生成
  async function handleStop() {
    const messageId = streamMessageIdRef.current;
    let stopRequest: Promise<Response> | undefined;
    if (messageId) {
      const token = getAccessToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      stopRequest = fetch(`/api/chat/messages/${messageId}/stop`, {
        method: 'POST',
        headers,
        credentials: 'include',
      });
    }
    abortControllerRef.current?.abort();
    if (stopRequest) {
      try {
        await stopRequest;
      } catch {
        // The SSE request is already cancelled locally.
      }
    }
  }

  // 重试
  async function handleRetry(messageId: string) {
    if (isStreaming) return;
    setError(null);

    const retryPlaceholder: ChatMessage = {
      id: `temp-retry-${Date.now()}`,
      role: 'assistant',
      status: 'streaming',
      content: '',
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, retryPlaceholder]);
    setIsStreaming(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const token = getAccessToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`/api/chat/messages/${messageId}/retry`, {
        method: 'POST',
        headers,
        credentials: 'include',
        signal: abortController.signal,
      });

      if (!res.ok || !res.body) {
        setMessages((prev) =>
          prev.map((m) => (m.id === retryPlaceholder.id ? { ...m, status: 'failed' } : m)),
        );
        setIsStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEventType = '';
      let newMessageId = '';
      let accumulatedText = '';
      let terminalReceived = false;
      const sources: MessageSourceData[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6)) as SSEEvent;

              if (currentEventType === 'start') {
                newMessageId = event.messageId;
                setMessages((prev) =>
                  prev.map((m) => (m.id === retryPlaceholder.id ? { ...m, id: newMessageId } : m)),
                );
              } else if (currentEventType === 'delta') {
                const deltaEvent = event as SSEDeltaEvent;
                setStatusStage(null);
                accumulatedText += deltaEvent.text;
                newMessageId = event.messageId || newMessageId;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === (newMessageId || retryPlaceholder.id)
                      ? { ...m, content: accumulatedText, id: newMessageId }
                      : m,
                  ),
                );
              } else if (currentEventType === 'source') {
                const sourceEvent = event as SSESourceEvent;
                sources.push({
                  id: sourceEvent.source.id,
                  ordinal: sourceEvent.source.ordinal,
                  sourceType: sourceEvent.source.type,
                  title: sourceEvent.source.title,
                  url: sourceEvent.source.url,
                  wikiPath: sourceEvent.source.wikiPath,
                });
              } else if (currentEventType === 'status') {
                const statusEvent = event as SSEStatusEvent;
                setStatusStage(
                  statusEvent.stage === 'complete'
                    ? null
                    : { stage: statusEvent.stage, message: statusEvent.message },
                );
              } else if (currentEventType === 'done') {
                terminalReceived = true;
                const doneEvent = event as SSEDoneEvent;
                setStatusStage(null);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === newMessageId
                      ? {
                          ...m,
                          status: doneEvent.status === 'complete' ? 'complete' : 'interrupted',
                          content: accumulatedText,
                          sources: sources.length > 0 ? sources : undefined,
                        }
                      : m,
                  ),
                );
              } else if (currentEventType === 'error') {
                terminalReceived = true;
                const errorEvent = event as SSEErrorEvent;
                setError(errorEvent.message);
                setStatusStage(null);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === (newMessageId || retryPlaceholder.id)
                      ? { ...m, status: 'failed', id: newMessageId || m.id }
                      : m,
                  ),
                );
              }
            } catch {
              // 跳过
            }
          }
        }
      }
      if (!terminalReceived && newMessageId) {
        if (!accumulatedText) setError('回答流意外中断，请重试');
        setMessages((prev) =>
          prev.map((m) =>
            m.id === newMessageId && m.status === 'streaming'
              ? {
                  ...m,
                  status: accumulatedText ? 'interrupted' : 'failed',
                  content: accumulatedText,
                }
              : m,
          ),
        );
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError('网络异常，请重试');
        setMessages((prev) =>
          prev.map((m) => (m.id === retryPlaceholder.id ? { ...m, status: 'failed' } : m)),
        );
      }
    } finally {
      setStatusStage(null);
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }

  const lastFailedMessage = messages
    .filter((m) => m.role === 'assistant' && m.status === 'failed')
    .pop();

  return (
    <div className="flex h-full flex-col">
      {/* 消息区 */}
      <div className="flex-1 overflow-y-auto px-3 py-3 sm:px-6 sm:py-4">
        <div className="mx-auto max-w-3xl space-y-3">
          {!loaded && !error && (
            <div role="status" className="py-16 text-center text-sm text-gray-400">
              正在加载会话…
            </div>
          )}

          {messages.length === 0 && loaded && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-base font-medium text-gray-400">开始一段新对话</p>
              <p className="mt-1 text-xs text-gray-400 sm:text-sm">输入问题或点击上方推荐问题</p>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {/* 服务端映射的 Qoder 工具阶段；不在前端推测 Agent 思考。 */}
          {statusStage && isStreaming && (
            <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-700">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-500" />
              <span>{statusStage.message}</span>
            </div>
          )}

          {/* 重试按钮 */}
          {lastFailedMessage && !isStreaming && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => handleRetry(lastFailedMessage.id)}
                className="flex min-h-[44px] items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                重试
              </button>
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 输入框 */}
      <div className="mx-auto w-full max-w-3xl px-3 sm:px-4">
        <ChatInput
          sessionId={sessionId}
          disabled={!loaded}
          isStreaming={isStreaming}
          onSendMessage={sendMessage}
          onStop={handleStop}
          webSearchEnabled={webSearchEnabled}
          onWebSearchChange={handleWebSearchChange}
          webSearchUpdating={webSearchUpdating}
        />
      </div>
    </div>
  );
}
