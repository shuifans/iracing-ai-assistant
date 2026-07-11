'use client';

import type { FeedbackStats as FeedbackStatsType } from '@/modules/analytics/types';

interface FeedbackStatsProps {
  data: FeedbackStatsType | null;
  loading?: boolean;
}

export function FeedbackStats({ data, loading = false }: FeedbackStatsProps) {
  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-gray-200 bg-white">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm text-gray-400">
        暂无反馈数据
      </div>
    );
  }

  const upRate = (data.upRate * 100).toFixed(1);
  const upWidth = data.total > 0 ? (data.up / data.total) * 100 : 0;
  const downWidth = data.total > 0 ? (data.down / data.total) * 100 : 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="mb-4 text-sm font-semibold text-gray-700">反馈统计</h3>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-gray-500">总反馈数</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{data.total}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">👍 赞</p>
          <p className="mt-1 text-xl font-bold text-green-600">{data.up}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">👎 踩</p>
          <p className="mt-1 text-xl font-bold text-red-600">{data.down}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">赞率</p>
          <p className="mt-1 text-xl font-bold text-blue-600">{upRate}%</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-5">
        <p className="mb-2 text-xs text-gray-500">赞 / 踩 比例</p>
        <div className="flex h-4 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="bg-green-500 transition-all duration-500"
            style={{ width: `${upWidth}%` }}
            title={`赞: ${data.up}`}
          />
          <div
            className="bg-red-400 transition-all duration-500"
            style={{ width: `${downWidth}%` }}
            title={`踩: ${data.down}`}
          />
        </div>
        <div className="mt-1 flex justify-between text-xs text-gray-400">
          <span>赞 {upWidth.toFixed(0)}%</span>
          <span>踩 {downWidth.toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
}
