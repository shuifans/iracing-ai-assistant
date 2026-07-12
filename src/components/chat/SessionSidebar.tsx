'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { authFetch } from '@/lib/auth-client';
import type { ChatSessionSummary } from '@/modules/chat/types';

interface SessionSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SessionSidebar({ isOpen, onClose }: SessionSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/chat/sessions?limit=50');
      if (res.ok) {
        const json = (await res.json()) as {
          data: { sessions: ChatSessionSummary[] };
        };
        setSessions(json.data.sessions);
      }
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await authFetch('/api/chat/sessions?limit=50');
        if (!cancelled && res.ok) {
          const json = (await res.json()) as {
            data: { sessions: ChatSessionSummary[] };
          };
          setSessions(json.data.sessions);
        }
      } catch {
        // 静默失败
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleNewSession() {
    try {
      const res = await authFetch('/api/chat/sessions', { method: 'POST' });
      if (res.ok) {
        const json = (await res.json()) as { data: { id: string } };
        router.push(`/chat/${json.data.id}`);
        onClose();
      }
    } catch {
      // 静默失败
    }
  }

  function handleSessionClick(sessionId: string) {
    router.push(`/chat/${sessionId}`);
    onClose();
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
        // 如果删除的是当前会话，跳转到首页
        if (pathname.includes(sessionId)) {
          router.push('/chat');
        }
      }
    } catch {
      // 静默失败
    }
  }

  return (
    <>
      {/* 遮罩层 */}
      {isOpen && (
        <div className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={onClose} aria-hidden />
      )}

      {/* 侧边栏 */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-gray-950 text-white transition-transform duration-200 md:relative md:z-auto md:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="会话历史"
      >
        {/* 顶部 */}
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <h2 className="text-sm font-semibold tracking-tight">iRacing AI 助手</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white md:hidden"
            aria-label="关闭侧边栏"
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

        {/* 新建会话按钮 */}
        <div className="px-3 py-3">
          <button
            type="button"
            onClick={handleNewSession}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-gray-700 px-3.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
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
        <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="会话列表">
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
                className={`group mb-1 flex min-h-[44px] cursor-pointer items-center justify-between rounded-lg px-3 py-1.5 text-[13px] leading-5 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                  isActive
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <span className="flex-1 truncate">{session.title || '新会话'}</span>
                <button
                  type="button"
                  onClick={(e) => handleDeleteSession(e, session.id)}
                  className="ml-2 flex min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center rounded text-gray-500 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100 focus:opacity-100"
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

        {/* 底部退出 */}
        <div className="border-t border-gray-800 px-3 py-3">
          <button
            type="button"
            onClick={async () => {
              try {
                await authFetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
              } catch {
                // 静默
              }
              window.location.href = '/login';
            }}
            className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] leading-5 text-gray-300 transition-colors hover:bg-gray-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
            退出登录
          </button>
        </div>
      </aside>
    </>
  );
}
