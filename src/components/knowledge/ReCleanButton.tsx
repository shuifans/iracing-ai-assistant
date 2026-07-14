'use client';

import { useState, useCallback, useEffect } from 'react';
import { authFetch } from '@/lib/auth-client';

interface VersionView {
  id: string;
  title: string;
  version: number;
  status: string;
  createdAt: string;
}

export function ReCleanButton({
  draftId,
  onRefresh,
}: {
  draftId: string;
  onRefresh?: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ jobId: string; version: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionView[]>([]);

  const fetchVersions = useCallback(async () => {
    try {
      const res = await authFetch(`/api/knowledge/drafts/${draftId}/versions`);
      if (res.ok) {
        const json = (await res.json()) as { data: { versions: VersionView[] } };
        setVersions(json.data.versions);
      }
    } catch {
      /* ignore */
    }
  }, [draftId]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  const trigger = async () => {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await authFetch(`/api/knowledge/drafts/${draftId}/re-clean`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message?: string } };
        throw new Error(json.error?.message ?? '重洗失败');
      }
      const json = (await res.json()) as { data: { jobId: string; version: number } };
      setResult({ jobId: json.data.jobId, version: json.data.version });
      await fetchVersions();
      onRefresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '重洗失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">带反馈重洗</h3>
        <button
          type="button"
          onClick={trigger}
          disabled={submitting}
          className="inline-flex min-h-[36px] min-w-[36px] items-center rounded-md bg-blue-600 px-4 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50"
        >
          {submitting ? '入队中…' : '带反馈重洗'}
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        将累积的未应用反馈作为指令入队新的清洗任务，生成下一版草稿并自动重新评估。
      </p>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {result && (
        <p className="mt-2 text-sm text-green-700">
          ✓ 重洗任务已入队（job {result.jobId.slice(0, 8)}…），将生成 v{result.version} 草稿，
          清洗完成后自动评估。请到「任务列表」查看进度。
        </p>
      )}

      {versions.length > 1 && (
        <div className="mt-4 border-t border-gray-200 pt-3">
          <p className="text-xs font-medium text-gray-500">版本历史（{versions.length}）</p>
          <ul className="mt-2 space-y-1">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center gap-2 text-xs text-gray-600">
                <span className="font-mono font-medium">v{v.version}</span>
                <span className="truncate">{v.title}</span>
                <span className="text-gray-400">· {v.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
