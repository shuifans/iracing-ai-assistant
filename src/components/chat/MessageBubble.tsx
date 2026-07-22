'use client';

import type { ChatMessage } from '@/modules/chat/types';
import { SourceCard } from '@/components/chat/SourceCard';
import { FeedbackButtons } from '@/components/chat/FeedbackButtons';
import { SafeMarkdown } from '@/components/chat/SafeMarkdown';

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isComplete = message.status === 'complete';
  const isFailed = message.status === 'failed';
  const isStreaming = message.status === 'streaming' || message.status === 'pending';

  // Format timing for display
  const formatMs = (ms: number | undefined): string => {
    if (ms === undefined) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const timingColor = (ms: number | undefined, good: number, warn: number): string => {
    if (ms === undefined) return 'text-gray-400';
    if (ms <= good) return 'text-green-600';
    if (ms <= warn) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 shadow-sm sm:max-w-[78%] ${
          isUser
            ? 'bg-brand-600 text-white shadow-brand-600/10'
            : 'border border-gray-200/80 bg-white text-gray-900'
        }`}
      >
        {/* 消息内容 */}
        {isAssistant ? (
          <div className="max-w-none overflow-x-auto break-words text-[14px] leading-[1.65] tracking-normal text-gray-900 [&_li]:pl-0.5 [&_li]:leading-[1.65] [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold">
            <SafeMarkdown>{message.content}</SafeMarkdown>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words text-[14px] leading-[1.65] tracking-normal">
            {message.content}
          </p>
        )}

        {/* 流式指示器 */}
        {isStreaming && !message.content && (
          <div className="flex items-center gap-1 text-gray-400">
            <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
            <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
            <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
          </div>
        )}

        {/* 失败提示 */}
        {isFailed && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
            生成失败，请重试
          </div>
        )}

        {/* 来源引用（assistant 完整消息） */}
        {isAssistant && isComplete && message.sources && message.sources.length > 0 && (
          <div className="mt-2.5 space-y-1.5 border-t border-gray-100 pt-2.5">
            <p className="text-xs font-medium text-gray-500">参考来源</p>
            <div className="space-y-1.5">
              {message.sources.map((source) => (
                <SourceCard key={source.id} source={source} />
              ))}
            </div>
          </div>
        )}

        {/* 反馈按钮（完整 assistant 消息） */}
        {isAssistant && isComplete && (
          <div className="mt-1.5 border-t border-gray-100 pt-1.5">
            <FeedbackButtons
              messageId={message.id}
              initialRating={(message.feedback?.rating as 'up' | 'down' | null) ?? null}
            />
          </div>
        )}

        {/* 性能计时信息（完整 assistant 消息） */}
        {isAssistant && isComplete && message.timing && (
          <div className="mt-2 border-t border-gray-100 pt-2">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <div className="flex items-center gap-1">
                <span className="text-gray-500">首字节:</span>
                <span
                  className={`font-mono font-medium ${timingColor(message.timing.agentFirstByteMs, 5000, 15000)}`}
                >
                  {formatMs(message.timing.agentFirstByteMs)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-500">流式传输:</span>
                <span
                  className={`font-mono font-medium ${timingColor(message.timing.agentStreamMs, 20000, 60000)}`}
                >
                  {formatMs(message.timing.agentStreamMs)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-500">总计:</span>
                <span
                  className={`font-mono font-medium ${timingColor(message.timing.totalMs, 30000, 90000)}`}
                >
                  {formatMs(message.timing.totalMs)}
                </span>
              </div>
              {message.timing.inputTokens && message.timing.outputTokens && (
                <div className="flex items-center gap-1">
                  <span className="text-gray-500">Token:</span>
                  <span className="font-mono font-medium text-gray-600">
                    {message.timing.inputTokens.toLocaleString()} →{' '}
                    {message.timing.outputTokens.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
