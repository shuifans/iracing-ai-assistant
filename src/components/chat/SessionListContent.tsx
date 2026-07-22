'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth-client';
import type { ChatSessionSummary } from '@/modules/chat/types';

interface SessionListContentProps {
  onNavigate?: () => void;
}

export function SessionListContent({ onNavigate }: SessionListContentProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSessions = useCallback(async (cancelled?: () => boolean) => {
    setLoading(true);
    try {
      const res = await authFetch('/api/chat/sessions?limit=50');
      if (res.ok && !cancelled?.()) {
        const json = (await res.json()) as {
          data: { sessions: ChatSessionSummary[] };
        };
        setSessions(json.data.sessions);
      }
    } catch {
      // 静默失败
    } finally {
      if (!cancelled?.()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchSessions(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [fetchSessions]);

  async function handleNewSession() {
    try {
      const res = await authFetch('/api/chat/sessions', { method: 'POST' });
      if (res.ok) {
        const json = (await res.json()) as { data: { id: string } };
        router.push(`/chat/${json.data.id}`);
        onNavigate?.();
      }
    } catch {
      // 静默失败
    }
  }

  function handleSessionClick(sessionId: string) {
    router.push(`/chat/${sessionId}`);
    onNavigate?.();
  }

  async function handleDeleteSession(e: React.MouseEvent, sessionId: string) {
    e.stopPropagation();
    if (!confirm('确定删除此会话？')) return;

    try {
      const res = await authFetch(`/api/chat/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        if (pathname.includes(sessionId)) {
          router.push('/chat');
        }
      }
    } catch {
      // 静默失败
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 新建会话按钮 */}
      <div className="px-3 py-3">
        <button
          type="button"
          onClick={handleNewSession}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-control bg-brand-600 px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          新建会话
        </button>
      </div>

      {/* 会话列表 */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4" aria-label="会话列表">
        {loading && sessions.length === 0 && (
          <p className="px-3 py-4 text-center text-[13px] text-gray-400">加载中…</p>
        )}
        {!loading && sessions.length === 0 && (
          <p className="px-3 py-4 text-center text-[13px] text-gray-400">暂无会话历史</p>
        )}
        {sessions.map((session) => {
          const isActive = pathname.includes(session.id);
          return (
            <div
              key={session.id}
              role="button"
              tabIndex={0}
              onClick={() => handleSessionClick(session.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSessionClick(session.id);
              }}
              className={`group mb-1 flex min-h-[44px] cursor-pointer items-center justify-between rounded-lg px-3 py-1.5 text-[13px] leading-5 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/40 ${
                isActive
                  ? 'bg-brand-50 font-medium text-brand-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-navy-900'
              }`}
            >
              <span className="flex-1 truncate">{session.title || '新会话'}</span>
              <button
                type="button"
                onClick={(e) => handleDeleteSession(e, session.id)}
                className="ml-2 flex min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center rounded text-gray-400 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100 focus:opacity-100"
                aria-label="删除会话"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            </div>
          );
        })}
      </nav>

      {/* 诊断工具 */}
      <div className="border-t border-gray-200 px-3 py-2">
        <button
          type="button"
          onClick={() => {
            router.push('/chat/diagnostic');
            onNavigate?.();
          }}
          className={`flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] leading-5 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/40 ${
            pathname.includes('/diagnostic')
              ? 'bg-brand-50 font-medium text-brand-700'
              : 'text-gray-600 hover:bg-gray-50 hover:text-navy-900'
          }`}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
          多轮对话诊断
        </button>
      </div>
    </div>
  );
}
