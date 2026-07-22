'use client';

import { useState, useEffect, useCallback, startTransition } from 'react';
import { authFetch } from '@/lib/auth-client';
import type {
  StatsOverview as StatsOverviewType,
  UsageTrend,
  PopularQuestion,
  CostSummary,
  FeedbackStats as FeedbackStatsType,
} from '@/modules/analytics/types';
import { StatsOverview } from '@/components/admin/StatsOverview';
import { UsageChart } from '@/components/admin/UsageChart';
import { PopularQuestions } from '@/components/admin/PopularQuestions';
import { CostTable } from '@/components/admin/CostTable';
import { FeedbackStats } from '@/components/admin/FeedbackStats';
import { PageHeader } from '@/components/common';

type Period = '7d' | '30d' | '90d';

function getDateRange(period: Period): { fromDate: string; toDate: string } {
  const now = new Date();
  const toDate = now.toISOString().slice(0, 10);
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  const fromDate = from.toISOString().slice(0, 10);
  return { fromDate, toDate };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await authFetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as { data: T };
    return json.data;
  } catch {
    return null;
  }
}

function useStats() {
  const [period, setPeriod] = useState<Period>('7d');
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<StatsOverviewType | null>(null);
  const [usage, setUsage] = useState<UsageTrend[]>([]);
  const [questions, setQuestions] = useState<PopularQuestion[]>([]);
  const [costs, setCosts] = useState<CostSummary[]>([]);
  const [feedback, setFeedback] = useState<FeedbackStatsType | null>(null);

  // Fix: useEffect 中直接 setState 会触发 react-hooks/set-state-in-effect
  // 将 fetch 逻辑封装为 useCallback，并通过 startTransition 包裹 setState
  // 批量合并状态更新，减少不必要的中间渲染
  const loadStats = useCallback(async (p: Period) => {
    setLoading(true);
    const { fromDate, toDate } = getDateRange(p);
    const qs = `fromDate=${fromDate}&toDate=${toDate}`;

    const [ov, us, qs2, cs, fb] = await Promise.all([
      fetchJson<StatsOverviewType>(`/api/admin/stats/overview?${qs}`),
      fetchJson<UsageTrend[]>(`/api/admin/stats/usage?period=day&${qs}`),
      fetchJson<PopularQuestion[]>(`/api/admin/stats/popular-questions?limit=20`),
      fetchJson<CostSummary[]>(`/api/admin/stats/costs?${qs}`),
      fetchJson<FeedbackStatsType>(`/api/admin/stats/feedback?${qs}`),
    ]);

    // 使用 startTransition 批量合并 setState，减少不必要的渲染
    startTransition(() => {
      setOverview(ov);
      setUsage(us ?? []);
      setQuestions(qs2 ?? []);
      setCosts(cs ?? []);
      setFeedback(fb);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    startTransition(() => {
      loadStats(period);
    });
  }, [period, loadStats]);

  return { period, setPeriod, loading, overview, usage, questions, costs, feedback };
}

export default function StatsPage() {
  const { period, setPeriod, loading, overview, usage, questions, costs, feedback } = useStats();

  const periodOptions: { value: Period; label: string }[] = [
    { value: '7d', label: '最近 7 天' },
    { value: '30d', label: '最近 30 天' },
    { value: '90d', label: '最近 90 天' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="统计面板"
        description="系统使用量与性能概览"
        actions={
          <div className="flex gap-2">
            {periodOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  period === opt.value
                    ? 'bg-brand-600 text-white'
                    : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-100'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        }
      />

      {/* Overview cards */}
      <StatsOverview data={overview} loading={loading} />

      {/* Middle: usage chart + cost table */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <UsageChart data={usage} loading={loading} />
        <CostTable data={costs} loading={loading} />
      </div>

      {/* Bottom: popular questions + feedback */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PopularQuestions data={questions} loading={loading} />
        <FeedbackStats data={feedback} loading={loading} />
      </div>
    </div>
  );
}
