'use client';

import { DataTable } from '@/components/common';
import type { PopularQuestion } from '@/modules/analytics/types';

interface PopularQuestionsProps {
  data: PopularQuestion[];
  loading?: boolean;
}

type Row = PopularQuestion & Record<string, unknown>;

const columns = [
  {
    key: 'content',
    header: '问题内容',
    render: (item: Row) => (
      <span className="block max-w-xs truncate text-gray-700" title={item.content}>
        {item.content.length > 60 ? `${item.content.slice(0, 60)}…` : item.content}
      </span>
    ),
  },
  {
    key: 'count',
    header: '调用次数',
    render: (item: Row) => (
      <span className="font-medium text-gray-900">{item.count}</span>
    ),
  },
  {
    key: 'sessionId',
    header: 'Session',
    render: (item: Row) => (
      <a
        href={`/admin/sessions/${item.sessionId}`}
        className="text-blue-600 hover:underline"
        target="_blank"
        rel="noreferrer"
      >
        {item.sessionId.slice(0, 8)}…
      </a>
    ),
  },
];

export function PopularQuestions({ data, loading = false }: PopularQuestionsProps) {
  const rows: Row[] = data.map((d) => ({ ...d }));

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">热门问题 Top 20</h3>
      <DataTable<Row>
        columns={columns}
        data={rows}
        loading={loading}
        emptyMessage="暂无热门问题数据"
      />
    </div>
  );
}
