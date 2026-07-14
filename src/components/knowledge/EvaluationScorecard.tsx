'use client';

import { useState, useCallback, useEffect } from 'react';
import { authFetch } from '@/lib/auth-client';
import { DimensionBars } from './DimensionBars';

interface DimensionScoreView {
  dimensionKey: string;
  tier: string;
  score: number;
  weight: number;
  rationale?: string;
}

interface EvaluationView {
  evaluationId: string;
  tier: string;
  overallScore: number;
  status: string;
  deepEval: boolean;
  dimensions: DimensionScoreView[];
  errorMessage?: string | null;
  evaluatedAt: string;
}

const TIER_COLOR: Record<string, string> = {
  A: 'bg-green-100 text-green-800',
  B: 'bg-blue-100 text-blue-800',
  C: 'bg-yellow-100 text-yellow-800',
  D: 'bg-red-100 text-red-800',
  pending: 'bg-gray-100 text-gray-600',
};

export function EvaluationScorecard({
  draftId,
  onRefresh,
}: {
  draftId: string;
  onRefresh?: () => void;
}) {
  const [evaluation, setEvaluation] = useState<EvaluationView | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const fetchEval = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/knowledge/drafts/${draftId}/evaluation`);
      if (res.ok) {
        const json = (await res.json()) as { data: { evaluation: EvaluationView | null } };
        setEvaluation(json.data.evaluation);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [draftId]);

  useEffect(() => {
    fetchEval();
  }, [fetchEval]);

  const runEval = async () => {
    setRunning(true);
    try {
      const res = await authFetch(`/api/knowledge/drafts/${draftId}/evaluation`, {
        method: 'POST',
      });
      if (res.ok) {
        await fetchEval();
        onRefresh?.();
      }
    } catch {
      /* ignore */
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">知识评估</h3>
        <button
          type="button"
          onClick={runEval}
          disabled={running}
          className="inline-flex min-h-[36px] min-w-[36px] items-center rounded-md border border-blue-300 bg-white px-3 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50"
        >
          {running ? '评估中…' : '重新评估'}
        </button>
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-gray-500">加载中…</p>
      ) : evaluation ? (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${
                TIER_COLOR[evaluation.tier] ?? TIER_COLOR.pending
              }`}
            >
              等级 {evaluation.tier}
            </span>
            <div className="flex items-baseline gap-1">
              <span className="text-sm text-gray-600">总分</span>
              <span className="text-2xl font-bold text-gray-900">{evaluation.overallScore}</span>
              <span className="text-sm text-gray-400">/ 100</span>
            </div>
            <span className="text-xs text-gray-400">
              {evaluation.status}
              {evaluation.deepEval ? ' · 深度' : ''}
            </span>
          </div>

          {evaluation.errorMessage && (
            <p className="text-sm text-red-600">{evaluation.errorMessage}</p>
          )}

          <DimensionBars dimensions={evaluation.dimensions} />

          <p className="text-xs text-gray-400">
            评估时间：{new Date(evaluation.evaluatedAt).toLocaleString()}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-gray-500">
          暂无评估。点击「重新评估」生成评分卡（启发式 + 检索探针）。
        </p>
      )}
    </div>
  );
}
