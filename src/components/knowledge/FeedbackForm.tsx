'use client';

import { useState, useCallback, useEffect, startTransition } from 'react';
import { authFetch } from '@/lib/auth-client';

interface FeedbackView {
  id: string;
  comments?: string | null;
  createdAt: string;
  appliedToJobId?: string | null;
}

export function FeedbackForm({
  draftId,
  onSubmitted,
}: {
  draftId: string;
  onSubmitted?: () => void;
}) {
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [existing, setExisting] = useState<FeedbackView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchFeedback = useCallback(async () => {
    try {
      const res = await authFetch(`/api/knowledge/drafts/${draftId}/feedback`);
      if (res.ok) {
        const json = (await res.json()) as { data: { feedback: FeedbackView[] } };
        setExisting(json.data.feedback);
      }
    } catch {
      /* ignore */
    }
  }, [draftId]);

  useEffect(() => {
    // Wrapped in startTransition to avoid cascading renders (matches the
    // knowledge page hook's fetch-on-tab pattern).
    startTransition(() => {
      fetchFeedback();
    });
  }, [fetchFeedback]);

  const submit = async () => {
    if (!comments.trim()) {
      setError('请输入反馈内容');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await authFetch(`/api/knowledge/drafts/${draftId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments: comments.trim() }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message?: string } };
        throw new Error(json.error?.message ?? '提交失败');
      }
      setComments('');
      await fetchFeedback();
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-card border border-gray-200 bg-white shadow-card p-6">
      <h3 className="text-sm font-semibold text-gray-700">管理员反馈</h3>
      <textarea
        value={comments}
        onChange={(e) => setComments(e.target.value)}
        rows={3}
        placeholder="反馈：哪些需要改进、补充、修正…（重洗时将作为指令喂给清洗器）"
        className="mt-3 w-full resize-none rounded-lg border border-gray-300 bg-white p-3 text-sm text-gray-700 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !comments.trim()}
          className="inline-flex min-h-[36px] min-w-[36px] items-center rounded-md bg-green-600 px-4 py-1 text-xs font-medium text-white transition-colors hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500/40 disabled:opacity-50"
        >
          {submitting ? '提交中…' : '提交反馈'}
        </button>
      </div>

      {existing.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-gray-200 pt-3">
          <p className="text-xs font-medium text-gray-500">历史反馈（{existing.length}）</p>
          {existing.map((f) => (
            <div key={f.id} className="rounded-lg bg-gray-50 p-3">
              <p className="text-sm text-gray-700">{f.comments ?? '—'}</p>
              <p className="mt-1 text-xs text-gray-400">
                {new Date(f.createdAt).toLocaleString()}
                {f.appliedToJobId ? ' · 已用于重洗' : ' · 待应用'}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
