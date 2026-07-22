'use client';

import { Badge } from '@/components/common/Badge';
import { formatForDisplay } from '@/lib/datetime';

interface SessionRow {
  id: string;
  title: string;
  status: string;
  userId: string;
  username: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
}

interface SessionTableProps {
  sessions: SessionRow[];
  loading?: boolean;
  onSelect: (session: SessionRow) => void;
}

function statusVariant(status: string): 'default' | 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'active':
      return 'success';
    case 'closed':
      return 'default';
    default:
      return 'info';
  }
}

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {Array.from({ length: 5 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded bg-gray-200" />
        </td>
      ))}
    </tr>
  );
}

export function SessionTable({ sessions, loading = false, onSelect }: SessionTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-600">
              标题
            </th>
            <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-600">
              用户
            </th>
            <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-600">
              消息数
            </th>
            <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-600">
              创建时间
            </th>
            <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-600">
              最后消息
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
          ) : sessions.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">
                暂无会话
              </td>
            </tr>
          ) : (
            sessions.map((session) => (
              <tr
                key={session.id}
                onClick={() => onSelect(session)}
                className="cursor-pointer transition-colors hover:bg-brand-50"
              >
                <td className="max-w-xs truncate px-4 py-3 text-gray-900">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{session.title}</span>
                    <Badge label={session.status} variant={statusVariant(session.status)} />
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-700">{session.username}</td>
                <td className="px-4 py-3 text-gray-700">{session.messageCount}</td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                  {formatForDisplay(session.createdAt)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                  {formatForDisplay(session.lastMessageAt)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
