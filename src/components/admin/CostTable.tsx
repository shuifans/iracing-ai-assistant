'use client';

import { DataTable } from '@/components/common';
import type { CostSummary } from '@/modules/analytics/types';

interface CostTableProps {
  data: CostSummary[];
  loading?: boolean;
}

type Row = CostSummary & Record<string, unknown>;

function formatUsd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(4)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const columns = [
  {
    key: 'model',
    header: '模型',
    render: (item: Row) => (
      <span className="font-medium text-gray-900">{item.model}</span>
    ),
  },
  {
    key: 'totalTokenInput',
    header: 'Input Tokens',
    render: (item: Row) => formatTokens(item.totalTokenInput),
  },
  {
    key: 'totalTokenOutput',
    header: 'Output Tokens',
    render: (item: Row) => formatTokens(item.totalTokenOutput),
  },
  {
    key: 'totalCostMicroUsd',
    header: '成本 (USD)',
    render: (item: Row) => (
      <span className="font-semibold text-green-700">
        {formatUsd(item.totalCostMicroUsd)}
      </span>
    ),
  },
  {
    key: 'callCount',
    header: '调用次数',
    render: (item: Row) => item.callCount.toLocaleString(),
  },
];

export function CostTable({ data, loading = false }: CostTableProps) {
  // Compute totals
  const totals = data.reduce(
    (acc, d) => ({
      input: acc.input + d.totalTokenInput,
      output: acc.output + d.totalTokenOutput,
      cost: acc.cost + d.totalCostMicroUsd,
      calls: acc.calls + d.callCount,
    }),
    { input: 0, output: 0, cost: 0, calls: 0 },
  );

  const rowsWithTotal: Row[] = [
    ...data.map((d) => ({ ...d })),
    {
      model: '总计',
      totalTokenInput: totals.input,
      totalTokenOutput: totals.output,
      totalCostMicroUsd: totals.cost,
      callCount: totals.calls,
    } as Row,
  ];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">成本明细</h3>
      <DataTable<Row>
        columns={columns}
        data={rowsWithTotal}
        loading={loading}
        emptyMessage="暂无成本数据"
      />
    </div>
  );
}
