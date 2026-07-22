'use client';

import { useState } from 'react';
import { DataTable } from '@/components/common/DataTable';
import { Badge } from '@/components/common/Badge';
import type { AuditLogEntry } from '@/modules/audit/types';

type Row = AuditLogEntry & Record<string, unknown>;

function actionBadgeVariant(action: string): 'info' | 'success' | 'default' {
  if (action.startsWith('user.')) return 'info';
  if (action.startsWith('knowledge.')) return 'success';
  return 'default';
}

function ChangesCell({ json }: { json: string | null }) {
  const [expanded, setExpanded] = useState(false);

  if (!json) return <span className="text-gray-400">—</span>;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return <span className="text-gray-500">{json}</span>;
  }

  const formatted = JSON.stringify(parsed, null, 2);
  const isLong = formatted.length > 60;

  if (!isLong) {
    return <code className="text-xs text-gray-600">{formatted}</code>;
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-xs font-medium text-brand-600 hover:underline"
      >
        {expanded ? '收起' : '展开'}
      </button>
      {expanded && (
        <pre className="mt-1 max-h-48 overflow-auto rounded bg-gray-50 p-2 text-xs text-gray-700">
          {formatted}
        </pre>
      )}
    </div>
  );
}

const COLUMNS = [
  {
    key: 'createdAt',
    header: '时间',
    render: (item: Row) => (
      <span className="whitespace-nowrap text-xs text-gray-600">
        {new Date(item.createdAt).toLocaleString('zh-CN')}
      </span>
    ),
  },
  {
    key: 'actorId',
    header: '操作者',
    render: (item: Row) => (
      <span className="font-mono text-xs text-gray-700">{item.actorId.slice(0, 8)}…</span>
    ),
  },
  {
    key: 'action',
    header: '动作',
    render: (item: Row) => (
      <Badge label={item.action} variant={actionBadgeVariant(item.action)} />
    ),
  },
  {
    key: 'resource',
    header: '资源',
    render: (item: Row) => (
      <span className="text-xs text-gray-700">{item.resource}</span>
    ),
  },
  {
    key: 'resourceId',
    header: '资源 ID',
    render: (item: Row) => (
      <span className="font-mono text-xs text-gray-500">{item.resourceId.slice(0, 8)}…</span>
    ),
  },
  {
    key: 'changesJson',
    header: '变更',
    render: (item: Row) => <ChangesCell json={item.changesJson} />,
  },
];

interface AuditLogTableProps {
  data: AuditLogEntry[];
  loading?: boolean;
}

export function AuditLogTable({ data, loading }: AuditLogTableProps) {
  return (
    <DataTable<Row>
      columns={COLUMNS}
      data={data as Row[]}
      loading={loading}
      emptyMessage="暂无审计日志"
    />
  );
}
