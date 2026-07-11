'use client';

import { StatCard } from '@/components/common';
import type { StatsOverview as StatsOverviewType } from '@/modules/analytics/types';

interface StatsOverviewProps {
  data: StatsOverviewType | null;
  loading?: boolean;
}

export function StatsOverview({ data, loading = false }: StatsOverviewProps) {
  if (loading || !data) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-xl border border-gray-200 bg-white"
          />
        ))}
      </div>
    );
  }

  const avgDurationSec = (data.avgDurationMs / 1000).toFixed(2);
  const failurePct = (data.failureRate * 100).toFixed(1);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title="总调用数"
        value={data.totalCalls.toLocaleString()}
        subtitle="所选时间范围内"
      />
      <StatCard
        title="活跃用户"
        value={data.activeUsers.toLocaleString()}
        subtitle="至少一次调用"
      />
      <StatCard
        title="平均延迟"
        value={`${avgDurationSec}s`}
        subtitle="请求处理耗时"
      />
      <StatCard
        title="失败率"
        value={`${failurePct}%`}
        subtitle="错误调用占比"
        trend={data.failureRate > 0.05 ? 'down' : 'neutral'}
      />
    </div>
  );
}
