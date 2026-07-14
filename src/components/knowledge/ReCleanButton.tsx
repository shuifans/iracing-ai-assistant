'use client';

import { useState, useCallback, useEffect, startTransition } from 'react';
import { authFetch } from '@/lib/auth-client';
import { ConfirmDialog } from '@/components/common';

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
  // Soft-cap confirm gate — opens before every re-clean so the admin sees the
  // token-cost nudge and the "describe requirements once" guidance up front.
  const [confirmOpen, setConfirmOpen] = useState(false);

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
    // Wrapped in startTransition to avoid cascading renders (matches the
    // knowledge page hook's fetch-on-tab pattern).
    startTransition(() => {
      fetchVersions();
    });
  }, [fetchVersions]);

  // The current draft's version IS the per-note LLM re-clean count + 1 (each
  // re-clean produces version = parent.version + 1; manual edits don't bump it).
  const currentVersion = versions.find((v) => v.id === draftId)?.version ?? 1;
  const reCleanCount = Math.max(0, currentVersion - 1);
  const nextVersion = currentVersion + 1;

  // Progressive soft-cap message — never hard-disables, just nudges harder as
  // token spend accumulates. The first re-clean already carries the prompt to
  // describe the change request thoroughly to avoid iterating.
  const reCleanHint =
    reCleanCount === 0
      ? `此操作将消耗 LLM token 生成 v${nextVersion}。请尽量一次性描述清楚修改要求，避免反复重洗浪费 token。`
      : reCleanCount === 1
        ? `这是第 2 次重洗（将生成 v${nextVersion}）。每次重洗都消耗 token，请确认反馈已补充完整。`
        : `⚠ 已重洗 ${reCleanCount} 次，token 消耗累计较高。若仍不满意，建议手动编辑草稿或重新审视来源质量。仍要继续？`;

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
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700">带反馈重洗</h3>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              reCleanCount > 0 ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'
            }`}
          >
            重洗 {reCleanCount} 次 · 当前 v{currentVersion}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
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

      <ConfirmDialog
        isOpen={confirmOpen}
        title={`确认带反馈重洗${reCleanCount > 0 ? `（第 ${reCleanCount + 1} 次）` : ''}`}
        message={reCleanHint}
        confirmLabel="继续重洗"
        cancelLabel="取消"
        onConfirm={() => {
          setConfirmOpen(false);
          trigger();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
