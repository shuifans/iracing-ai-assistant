'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth-client';

interface HealthInfo {
  status: string;
  uptime?: number;
  version?: string;
  timestamp?: string;
}

export function SystemSettings() {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchHealth() {
      try {
        const res = await authFetch('/api/health/live');
        if (res.ok) {
          // /api/health/live returns the payload at the top level (no `data` envelope)
          const json = (await res.json()) as HealthInfo;
          setHealth(json);
        }
      } catch {
        // 静默
      } finally {
        setLoading(false);
      }
    }
    fetchHealth();
  }, []);

  function formatUptime(seconds?: number): string {
    if (!seconds && seconds !== 0) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h} 小时 ${m} 分钟`;
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-card border border-gray-200 bg-white shadow-card p-8">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
        <span className="text-sm text-gray-500">加载系统信息…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-card border border-gray-200 bg-white shadow-card p-6">
      <h3 className="text-base font-semibold text-gray-800">系统信息</h3>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <InfoCard label="服务状态" value={health?.status ?? '—'} />
        <InfoCard label="运行时长" value={formatUptime(health?.uptime)} />
        <InfoCard label="版本" value={health?.version ?? '—'} />
        <InfoCard label="时间戳" value={health?.timestamp ?? '—'} />
      </div>

      <p className="text-xs text-gray-400">
        此页面为系统设置预留入口，后续可扩展读写 system_settings 表。
      </p>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-4">
      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-500">{label}</p>
      <p className="text-sm font-semibold text-gray-800">{value}</p>
    </div>
  );
}
