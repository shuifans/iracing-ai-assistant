'use client';

import { useState, useEffect, useCallback, startTransition } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth-client';
import { Toast, Button, PageHeader, FullScreenLoader } from '@/components/common';
import { DraftReviewer } from '@/components/knowledge/DraftReviewer';
import { EvaluationScorecard } from '@/components/knowledge/EvaluationScorecard';
import { FeedbackForm } from '@/components/knowledge/FeedbackForm';
import { ReCleanButton } from '@/components/knowledge/ReCleanButton';

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
    return <FullScreenLoader label="加载候选稿…" />;
  }

  if (error || !data) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-600">{error ?? '数据不存在'}</p>
          <Button type="button" className="mt-4" onClick={() => router.push('/knowledge')}>
            返回知识管理
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      <PageHeader title="候选稿审核" back={{ href: '/knowledge', label: '返回知识管理' }} />

      <div className="mt-6 space-y-6">
        {data.draft.status === 'pending_review' && (
          <>
            <EvaluationScorecard draftId={data.draft.id} onRefresh={fetchDraft} />
            <FeedbackForm draftId={data.draft.id} onSubmitted={fetchDraft} />
            <ReCleanButton draftId={data.draft.id} onRefresh={fetchDraft} />
          </>
        )}
        <DraftReviewer
          draft={data.draft}
          source={data.source}
          extractedText={data.extractedText}
          renderedMarkdown={data.renderedMarkdown}
          onSuccess={() => {
            setToast({
              message: '操作成功；通过审查的知识可在「知识管理 → 管理知识 → 待发布」中发布上线',
              type: 'success',
            });
            fetchDraft();
          }}
          onError={(msg) => setToast({ message: msg, type: 'error' })}
        />
      </div>
    </div>
  );
}
