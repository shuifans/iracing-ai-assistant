'use client';

import { useMemo } from 'react';
import type { ChatMessage } from '@/modules/chat/types';
import { SourceCard } from '@/components/chat/SourceCard';
import { FeedbackButtons } from '@/components/chat/FeedbackButtons';

interface MessageBubbleProps {
  message: ChatMessage;
}

/**
 * 简易 Markdown 渲染（正则替换，不引入第三方库）
 * 支持：标题、粗体、斜体、行内代码、代码块、链接、列表、表格
 * SPEC §17.1：Markdown 渲染必须使用 allowlist sanitizer；禁止原始 HTML
 */
function renderMarkdown(text: string): string {
  if (!text) return '';

  let html = text;

  // 转义 HTML 实体（防止 XSS）
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // 代码块 ``` ... ```
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre class="overflow-x-auto rounded-lg bg-gray-900 p-4 text-sm text-gray-100"><code>${code.trim()}</code></pre>`;
  });

  // 行内代码 `...`
  html = html.replace(
    /`([^`\n]+)`/g,
    '<code class="rounded bg-gray-100 px-1.5 py-0.5 text-sm text-red-600">$1</code>',
  );

  // 标题 ### h3, ## h2, # h1
  html = html.replace(/^### (.+)$/gm, '<h3 class="mt-4 mb-2 text-lg font-bold">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="mt-4 mb-2 text-xl font-bold">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="mt-4 mb-2 text-2xl font-bold">$1</h1>');

  // 粗体 **text** 和斜体 *text*
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // 链接 [text](url)
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline hover:text-blue-800">$1</a>',
  );

  // 表格（简易实现：| a | b | 格式）
  const tableRegex = new RegExp(
    '(?:^|\\n)(\\|[^\\n]+\\|)\\n(\\|[-| :]+\\|)\\n((?:\\|[^\\n]+\\|\\n?)+)',
    'g',
  );
  html = html.replace(
    tableRegex,
    (_match, headerRow: string, _separatorRow: string, bodyRows: string) => {
      const headers = headerRow
        .split('|')
        .filter((c: string) => c.trim())
        .map(
          (c: string) =>
            `<th class="border border-gray-300 bg-gray-50 px-3 py-2 text-left text-sm font-semibold">${c.trim()}</th>`,
        )
        .join('');
      const rows = bodyRows
        .trim()
        .split('\n')
        .map((row: string) => {
          const cells = row
            .split('|')
            .filter((c: string) => c.trim())
            .map(
              (c: string) =>
                `<td class="border border-gray-300 px-3 py-2 text-sm">${c.trim()}</td>`,
            )
            .join('');
          return `<tr>${cells}</tr>`;
        })
        .join('');
      return `<div class="my-3 overflow-x-auto"><table class="min-w-full border-collapse border border-gray-300"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
    },
  );

  // 无序列表 - item
  html = html.replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>');
  // 连续 li 包裹在 ul
  html = html.replace(/((?:<li[^>]*>.*?<\/li>\n?)+)/g, '<ul class="my-2 space-y-1">$1</ul>');

  // 有序列表 1. item
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>');
  html = html.replace(
    /((?:<li class="ml-4 list-decimal">.*?<\/li>\n?)+)/g,
    '<ol class="my-2 space-y-1">$1</ol>',
  );

  // 段落换行（连续换行变段落分隔）
  html = html.replace(/\n{2,}/g, '</p><p class="my-2">');
  html = html.replace(/\n/g, '<br/>');

  // 包裹在段落中（不包裹已有块级元素）
  const blockTags = /<(h[1-6]|ul|ol|pre|div|table|blockquote)/;
  if (!blockTags.test(html)) {
    html = `<p class="my-2">${html}</p>`;
  }

  return html;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isComplete = message.status === 'complete';
  const isFailed = message.status === 'failed';
  const isStreaming = message.status === 'streaming' || message.status === 'pending';

  const renderedContent = useMemo(() => {
    if (isAssistant) {
      return renderMarkdown(message.content);
    }
    return message.content;
  }, [message.content, isAssistant]);

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'border border-gray-200 bg-white text-gray-900'
        }`}
      >
        {/* 消息内容 */}
        {isAssistant ? (
          <div
            className="prose prose-sm max-w-none overflow-hidden break-words"
            dangerouslySetInnerHTML={{ __html: renderedContent }}
          />
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm">{renderedContent}</p>
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
          <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
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
          <div className="mt-2 border-t border-gray-100 pt-2">
            <FeedbackButtons
              messageId={message.id}
              initialRating={(message.feedback?.rating as 'up' | 'down' | null) ?? null}
            />
          </div>
        )}
      </div>
    </div>
  );
}
