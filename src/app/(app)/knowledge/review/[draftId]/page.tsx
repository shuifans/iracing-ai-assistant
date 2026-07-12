'use client';

import { useState, useEffect, useCallback, startTransition } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth-client';
import { Toast } from '@/components/common';
import { DraftReviewer } from '@/components/knowledge/DraftReviewer';

interface DraftDetail {
  draft: {
    id: string;
    title: string;
    status: string;
    suggestedPath: string;
    frontMatterJson: string;
    draftRelativePath: string;
    reviewNotes?: string | null;
    createdAt: string;
  };
  source: {
    id: string;
    inputType: string;
    originalName?: string | null;
    sourceUrl?: string | null;
  };
  extractedText: string | null;
  renderedMarkdown: string;
}

function useDraftDetail(draftId: string) {
  const [data, setData] = useState<DraftDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDraft = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/knowledge/drafts/${draftId}`);
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message?: string } };
        throw new Error(json.error?.message ?? '加载候选稿失败');
      }
      const json = (await res.json()) as { data: DraftDetail };
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [draftId]);

  useEffect(() => {
    startTransition(() => {
      if (draftId) fetchDraft();
    });
  }, [draftId, fetchDraft]);

  return { data, loading, error, fetchDraft };
}

export default function ReviewPage() {
  const params = useParams<{ draftId: string }>();
  const router = useRouter();
  const draftId = params.draftId;

  const { data, loading, error, fetchDraft } = useDraftDetail(draftId);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          <p className="text-sm text-gray-600">加载候选稿…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-sm text-red-600">{error ?? '数据不存在'}</p>
          <button
            type="button"
            onClick={() => router.push('/knowledge')}
            className="mt-4 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            返回知识管理
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      {/* Header */}
      <div className="flex items-center gap-4 border-b border-gray-200 bg-white px-6 py-4">
        <button
          type="button"
          onClick={() => router.push('/knowledge')}
          className="inline-flex min-h-[44px] min-w-[44px] items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          返回
        </button>
        <h1 className="text-lg font-semibold text-gray-900">候选稿审核</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <DraftReviewer
          draft={data.draft}
          source={data.source}
          extractedText={data.extractedText}
          renderedMarkdown={data.renderedMarkdown}
          onSuccess={() => {
            setToast({ message: '操作成功', type: 'success' });
            fetchDraft();
          }}
          onError={(msg) => setToast({ message: msg, type: 'error' })}
        />
      </div>
    </div>
  );
}
