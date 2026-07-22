'use client';

import { useState, useEffect, useCallback } from 'react';
import { Tabs, PageHeader } from '@/components/common';
import { RateLimitTable } from '@/components/admin/RateLimitTable';
import { SystemSettings } from '@/components/admin/SystemSettings';
import { authFetch } from '@/lib/auth-client';
import type { RateLimitConfig } from '@/modules/rate-limit/types';

const TABS = [
  { id: 'rate-limits', label: '限流配置' },
  { id: 'system', label: '系统设置' },
];

export default function AdminSettingsPage() {
  const [activeTab, setActiveTab] = useState('rate-limits');
  const [configs, setConfigs] = useState<RateLimitConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchConfigs() {
      setLoading(true);
      try {
        const res = await authFetch('/api/admin/rate-limits');
        if (res.ok) {
          const json = (await res.json()) as { data: { configs: RateLimitConfig[] } };
          setConfigs(json.data.configs);
        }
      } catch {
        // 静默
      } finally {
        setLoading(false);
      }
    }
    if (activeTab === 'rate-limits') {
      fetchConfigs();
    }
  }, [activeTab]);

  const handleUpdated = useCallback((updated: RateLimitConfig) => {
    setConfigs((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader title="系统设置" description="管理限流策略与系统参数" />

      {/* Tabs */}
      <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

      {/* Tab 内容 */}
      {activeTab === 'rate-limits' && (
        <RateLimitTable configs={configs} loading={loading} onUpdated={handleUpdated} />
      )}

      {activeTab === 'system' && <SystemSettings />}
    </div>
  );
}
