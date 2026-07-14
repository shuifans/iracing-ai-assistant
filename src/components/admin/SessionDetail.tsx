'use client';

import { Badge } from '@/components/common/Badge';
import { SafeMarkdown } from '@/components/chat/SafeMarkdown';
import { formatForDisplay } from '@/lib/datetime';

interface AdminMessage {
  id: string;
  role: string;
  status: string;
  content: string;
  createdAt: string;
}

interface AdminSession {
  id: string;
  title: string;
  status: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
}

interface SessionDetailProps {
  session: AdminSession;
  messages: AdminMessage[];
  onClose: () => void;
}

function statusVariant(status: string): 'default' | 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'active':
      return 'success';
    case 'closed':
      return 'default';
    default:
      return 'info';
  }
}

function roleBadge(role: string): {
  label: string;
  variant: 'default' | 'success' | 'warning' | 'danger' | 'info';
} {
  switch (role) {
    case 'user':
      return { label: '用户', variant: 'info' };
    case 'assistant':
      return { label: 'AI', variant: 'success' };
    case 'system':
      return { label: '系统', variant: 'warning' };
    default:
      return { label: role, variant: 'default' };
  }
}

export function SessionDetail({ session, messages, onClose }: SessionDetailProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-gray-900">{session.title}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span>ID: {session.id.slice(0, 8)}…</span>
              <span>·</span>
              <span>用户: {session.userId.slice(0, 8)}…</span>
              <span>·</span>
              <span>创建: {formatForDisplay(session.createdAt)}</span>
              <Badge label={session.status} variant={statusVariant(session.status)} />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="关闭"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">暂无消息</p>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              const { label, variant } = roleBadge(msg.role);

              return (
                <div
                  key={msg.id}
                  className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                      isUser
                        ? 'bg-blue-600 text-white'
                        : 'border border-gray-200 bg-white text-gray-900'
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <Badge label={label} variant={variant} />
                      <span className={`text-xs ${isUser ? 'text-blue-200' : 'text-gray-400'}`}>
                        {formatForDisplay(msg.createdAt)}
                      </span>
                    </div>
                    {msg.role === 'assistant' ? (
                      <div className="prose prose-sm max-w-none overflow-hidden break-words">
                        <SafeMarkdown>{msg.content}</SafeMarkdown>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap break-words text-sm">{msg.content}</p>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-3 text-xs text-gray-400">
          共 {messages.length} 条消息 · 访问已记录审计日志
        </div>
      </div>
    </div>
  );
}
