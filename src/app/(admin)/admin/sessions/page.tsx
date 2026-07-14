'use client';

import { use, useEffect, useState, useCallback, startTransition } from 'react';
import { authFetch } from '@/lib/auth-client';
import { Pagination } from '@/components/common/Pagination';
import { SessionTable } from '@/components/admin/SessionTable';
import { SessionDetail } from '@/components/admin/SessionDetail';

interface AdminSession {
  id: string;
  title: string;
  status: string;
  userId: string;
  username: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
}

interface SessionMessage {
  id: string;
  role: string;
  status: string;
  content: string;
  createdAt: string;
}

const PAGE_LIMIT = 20;

function useAdminSessions(userId: string, keyword: string, fromDate: string, toDate: string) {
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [searchNonce, setSearchNonce] = useState(0);

  const currentCursor = cursorStack.length > 0 ? cursorStack[cursorStack.length - 1] : undefined;

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (userId) params.set('userId', userId);
      if (keyword) params.set('keyword', keyword);
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);
      if (currentCursor) params.set('cursor', currentCursor);

      const res = await authFetch(`/api/admin/sessions?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        data: { sessions: AdminSession[] };
        meta: { nextCursor: string | null };
      };
      setSessions(json.data.sessions);
      setNextCursor(json.meta.nextCursor);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [userId, keyword, fromDate, toDate, currentCursor]);

  useEffect(() => {
    startTransition(() => {
      fetchSessions();
    });
  }, [fetchSessions, searchNonce]);

  function handleSearch() {
    // Reset to page 1. Don't call fetchSessions() directly — it closes over the
    // stale currentCursor from this render and would issue a duplicate request
    // with the old cursor before the effect re-runs with the reset cursor.
    setCursorStack([]);
    setSearchNonce((n) => n + 1);
  }

  function handleNext(cursor: string) {
    setCursorStack((prev) => [...prev, cursor]);
  }

  function handlePrev() {
    setCursorStack((prev) => prev.slice(0, -1));
  }

  return { sessions, loading, nextCursor, cursorStack, handleSearch, handleNext, handlePrev };
}

export default function AdminSessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ sessionId?: string }>;
}) {
  const { sessionId } = use(searchParams);
  // Filters
  const [userId, setUserId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const { sessions, loading, nextCursor, cursorStack, handleSearch, handleNext, handlePrev } = useAdminSessions(userId, keyword, fromDate, toDate);

  // Detail modal
  const [selectedSession, setSelectedSession] = useState<AdminSession | null>(null);
  const [detailMessages, setDetailMessages] = useState<SessionMessage[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Deep-link: /admin/sessions?sessionId=xxx (e.g. from PopularQuestions) auto-opens
  // that session's detail without requiring a row click in the table.
  useEffect(() => {
    const sid = sessionId;
    if (!sid) return;
    let cancelled = false;
    setDetailLoading(true);
    setSelectedSession(null);
    (async () => {
      try {
        const res = await authFetch(`/api/admin/sessions/${sid}`);
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as {
          data: { session: AdminSession; messages: SessionMessage[] };
        };
        if (cancelled) return;
        setSelectedSession(json.data.session);
        setDetailMessages(json.data.messages);
      } catch {
        // ignore — user can still select from the table
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function handleSelectSession(session: AdminSession) {
    setSelectedSession(session);
    setDetailLoading(true);
    setDetailMessages([]);
    try {
      const res = await authFetch(`/api/admin/sessions/${session.id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        data: { session: AdminSession; messages: SessionMessage[] };
      };
      setDetailMessages(json.data.messages);
    } catch (err) {
      console.error('Failed to fetch session detail:', err);
    } finally {
      setDetailLoading(false);
    }
  }

  function handleCloseDetail() {
    setSelectedSession(null);
    setDetailMessages([]);
  }

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">会话质检</h1>
        <p className="mt-1 text-sm text-gray-500">查看和检索所有用户的会话记录</p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex min-w-[140px] flex-1 flex-col gap-1">
          <label htmlFor="filter-userId" className="text-xs font-medium text-gray-600">
            用户 ID
          </label>
          <input
            id="filter-userId"
            type="text"
            placeholder="输入用户 ID…"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="flex min-w-[140px] flex-1 flex-col gap-1">
          <label htmlFor="filter-keyword" className="text-xs font-medium text-gray-600">
            关键词
          </label>
          <input
            id="filter-keyword"
            type="text"
            placeholder="搜索会话标题…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="flex min-w-[140px] flex-1 flex-col gap-1">
          <label htmlFor="filter-fromDate" className="text-xs font-medium text-gray-600">
            开始日期
          </label>
          <input
            id="filter-fromDate"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="flex min-w-[140px] flex-1 flex-col gap-1">
          <label htmlFor="filter-toDate" className="text-xs font-medium text-gray-600">
            结束日期
          </label>
          <input
            id="filter-toDate"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <button
          type="button"
          onClick={handleSearch}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        >
          搜索
        </button>
      </div>

      {/* Table */}
      <SessionTable sessions={sessions} loading={loading} onSelect={handleSelectSession} />

      {/* Pagination */}
      <Pagination
        nextCursor={nextCursor}
        onPrev={handlePrev}
        onNext={handleNext}
        hasPrev={cursorStack.length > 0}
      />

      {/* Detail modal */}
      {selectedSession && (
        <SessionDetail
          session={selectedSession}
          messages={detailLoading ? [] : detailMessages}
          onClose={handleCloseDetail}
        />
      )}
    </div>
  );
}
