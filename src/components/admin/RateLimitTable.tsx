'use client';

import { useState, useCallback } from 'react';
import { DataTable, Badge, Toast } from '@/components/common';
import { RateLimitForm } from './RateLimitForm';
import { authFetch } from '@/lib/auth-client';
import type { RateLimitConfig } from '@/modules/rate-limit/types';

interface RateLimitTableProps {
  configs: RateLimitConfig[];
  loading?: boolean;
  onUpdated: (updated: RateLimitConfig) => void;
}

type ToastState = { message: string; type: 'success' | 'error' | 'info' } | null;

interface DataTableColumn<T> {
  key: string;
  header: string;
  render?: (item: T) => React.ReactNode;
}

export function RateLimitTable({ configs, loading, onUpdated }: RateLimitTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  const editingConfig = editingId ? configs.find((c) => c.id === editingId) : undefined;

  async function handleToggleEnabled(config: RateLimitConfig) {
    try {
      const res = await authFetch(`/api/admin/rate-limits/${config.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !config.enabled }),
      });
      if (!res.ok) throw new Error('toggle failed');
      const json = (await res.json()) as { data: { config: RateLimitConfig } };
      onUpdated(json.data.config);
      setToast({ message: `已${json.data.config.enabled ? '启用' : '禁用'} ${config.scope} 限流`, type: 'success' });
    } catch {
      setToast({ message: '操作失败，请重试', type: 'error' });
    }
  }

  const handleSave = useCallback(
    async (data: {
      id: string;
      perMinuteLimit: number;
      perDayLimit: number;
      maxSessionTurns: number;
      enabled: boolean;
    }) => {
      setSaving(true);
      try {
        const res = await authFetch(`/api/admin/rate-limits/${data.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            perMinuteLimit: data.perMinuteLimit,
            perDayLimit: data.perDayLimit,
            maxSessionTurns: data.maxSessionTurns,
            enabled: data.enabled,
          }),
        });
        if (!res.ok) throw new Error('save failed');
        const json = (await res.json()) as { data: { config: RateLimitConfig } };
        onUpdated(json.data.config);
        setEditingId(null);
        setToast({ message: '配置保存成功', type: 'success' });
      } catch {
        setToast({ message: '保存失败，请重试', type: 'error' });
      } finally {
        setSaving(false);
      }
    },
    [onUpdated],
  );

  const columns: DataTableColumn<RateLimitConfig & Record<string, unknown>>[] = [
    {
      key: 'scope',
      header: '作用域 (Scope)',
      render: (item) => <span className="font-medium text-gray-800">{item.scope}</span>,
    },
    {
      key: 'scopeKey',
      header: 'Scope Key',
      render: (item) => <span className="text-gray-500">{item.scopeKey || '—'}</span>,
    },
    {
      key: 'perMinuteLimit',
      header: '每分钟',
      render: (item) => <span className="tabular-nums">{item.perMinuteLimit}</span>,
    },
    {
      key: 'perDayLimit',
      header: '每日',
      render: (item) => <span className="tabular-nums">{item.perDayLimit}</span>,
    },
    {
      key: 'maxSessionTurns',
      header: '最大轮数',
      render: (item) => <span className="tabular-nums">{item.maxSessionTurns}</span>,
    },
    {
      key: 'enabled',
      header: '状态',
      render: (item) => (
        <button
          type="button"
          onClick={() => handleToggleEnabled(item as RateLimitConfig)}
          className="focus:outline-none"
          aria-label={item.enabled ? '点击禁用' : '点击启用'}
        >
          <Badge
            label={item.enabled ? '已启用' : '已禁用'}
            variant={item.enabled ? 'success' : 'danger'}
          />
        </button>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      render: (item) => (
        <button
          type="button"
          onClick={() => setEditingId((item as RateLimitConfig).id)}
          className="rounded-md px-3 py-1 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        >
          编辑
        </button>
      ),
    },
  ];

  return (
    <>
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      <DataTable
        columns={columns}
        data={configs as (RateLimitConfig & Record<string, unknown>)[]}
        loading={loading}
        emptyMessage="暂无限流配置"
      />

      {/* 编辑弹窗 */}
      {editingConfig && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-md">
            <RateLimitForm
              initial={editingConfig}
              onSave={handleSave}
              onCancel={() => setEditingId(null)}
              saving={saving}
            />
          </div>
        </div>
      )}
    </>
  );
}
