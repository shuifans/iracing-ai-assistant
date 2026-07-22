'use client';

import { DataTable } from '@/components/common';
import { ItemStatusBadge, SyncStatusBadge } from './JobStatusBadge';

interface KnowledgeItem {
  id: string;
  title: string;
  category: string;
  subcategory: string;
  status: 'published' | 'archived';
  wikiSyncStatus: 'committed' | 'push_pending' | 'synced' | 'push_failed';
  season: string;
  wikiPath: string;
  publishedAt: string;
  [key: string]: unknown;
}

interface ItemTableProps {
  data: KnowledgeItem[];
  loading?: boolean;
  onArchive?: (id: string) => void;
  onRestore?: (id: string) => void;
  onViewContent?: (id: string) => void;
  onRevise?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export function ItemTable({
  data,
  loading,
  onArchive,
  onRestore,
  onViewContent,
  onRevise,
  onDelete,
}: ItemTableProps) {
  const columns = [
    {
      key: 'title',
      header: '标题',
      render: (item: KnowledgeItem) => (
        <span className="font-medium text-gray-900">{item.title}</span>
      ),
    },
    {
      key: 'category',
      header: '分类',
      render: (item: KnowledgeItem) => (
        <span className="text-gray-600">{item.category}</span>
      ),
    },
    {
      key: 'subcategory',
      header: '子分类',
      render: (item: KnowledgeItem) => (
        <span className="text-gray-500">{item.subcategory}</span>
      ),
    },
    {
      key: 'status',
      header: '状态',
      render: (item: KnowledgeItem) => <ItemStatusBadge status={item.status} />,
    },
    {
      key: 'wikiSyncStatus',
      header: '同步状态',
      render: (item: KnowledgeItem) => (
        <SyncStatusBadge status={item.wikiSyncStatus} />
      ),
    },
    {
      key: 'season',
      header: '赛季',
      render: (item: KnowledgeItem) => <span className="text-gray-500">{item.season}</span>,
    },
    {
      key: 'actions',
      header: '操作',
      render: (item: KnowledgeItem) => (
        <div className="flex gap-2">
          {onViewContent && (
            <button
              type="button"
              onClick={() => onViewContent(item.id)}
              className="inline-flex min-h-[36px] min-w-[36px] items-center rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            >
              查看正文
            </button>
          )}
          {item.status === 'published' && onRevise && (
            <button
              type="button"
              onClick={() => onRevise(item.id)}
              className="inline-flex min-h-[36px] min-w-[36px] items-center rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            >
              重新清洗
            </button>
          )}
          {item.status === 'published' && onArchive && (
            <button
              type="button"
              onClick={() => onArchive(item.id)}
              className="inline-flex min-h-[36px] min-w-[36px] items-center rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            >
              下线
            </button>
          )}
          {item.status === 'archived' && onRestore && (
            <button
              type="button"
              onClick={() => onRestore(item.id)}
              className="inline-flex min-h-[36px] min-w-[36px] items-center rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            >
              重新上线
            </button>
          )}
          {item.status === 'archived' && onDelete && (
            <button
              type="button"
              onClick={() => onDelete(item.id)}
              className="inline-flex min-h-[36px] min-w-[36px] items-center rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500/40"
            >
              删除
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <DataTable<KnowledgeItem>
      columns={columns}
      data={data}
      loading={loading}
      emptyMessage="暂无知识条目"
    />
  );
}
