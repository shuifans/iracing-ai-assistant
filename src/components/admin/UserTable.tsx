'use client';

import { Badge } from '@/components/common';
import type { UserSummary } from '@/modules/users/types';

type UserAction =
  | { type: 'approve'; user: UserSummary }
  | { type: 'reject'; user: UserSummary }
  | { type: 'disable'; user: UserSummary }
  | { type: 'enable'; user: UserSummary }
  | { type: 'changeRole'; user: UserSummary }
  | { type: 'delete'; user: UserSummary };

interface UserTableProps {
  users: UserSummary[];
  loading?: boolean;
  onAction: (action: UserAction) => void;
}

const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  knowledge_admin: '知识管理员',
  user: '普通用户',
};

const ROLE_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  admin: 'danger',
  knowledge_admin: 'warning',
  user: 'default',
};

const STATUS_LABELS: Record<string, string> = {
  pending: '待审批',
  active: '正常',
  rejected: '已拒绝',
  disabled: '已禁用',
};

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  pending: 'warning',
  active: 'success',
  rejected: 'danger',
  disabled: 'default',
};

function formatTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ActionButton({
  children,
  onClick,
  variant = 'default',
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: 'default' | 'primary' | 'danger' | 'success';
}) {
  const cls: Record<string, string> = {
    default: 'border-gray-300 text-gray-700 hover:bg-gray-50',
    primary: 'border-brand-500 text-brand-600 hover:bg-brand-50',
    danger: 'border-red-400 text-red-600 hover:bg-red-50',
    success: 'border-green-500 text-green-600 hover:bg-green-50',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-[32px] items-center rounded-md border px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/40 ${cls[variant]}`}
    >
      {children}
    </button>
  );
}

export function UserTable({ users, loading = false, onAction }: UserTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50">
          <tr>
            {['用户名', '角色', '状态', '注册时间', '最后登录', '操作'].map((h) => (
              <th
                key={h}
                className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-600"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <tr key={i} className="animate-pulse">
                {Array.from({ length: 6 }).map((__, j) => (
                  <td key={j} className="px-4 py-3">
                    <div className="h-4 rounded bg-gray-200" />
                  </td>
                ))}
              </tr>
            ))
          ) : users.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">
                暂无用户数据
              </td>
            </tr>
          ) : (
            users.map((user) => (
              <tr key={user.id} className="transition-colors hover:bg-gray-50">
                {/* 用户名 */}
                <td className="px-4 py-3 font-medium text-gray-900">
                  <div className="flex flex-col">
                    <span>{user.username}</span>
                    {user.registrationReason && (
                      <span className="mt-0.5 max-w-[180px] truncate text-xs text-gray-400" title={user.registrationReason}>
                        {user.registrationReason}
                      </span>
                    )}
                  </div>
                </td>

                {/* 角色 */}
                <td className="px-4 py-3">
                  <Badge label={ROLE_LABELS[user.role] ?? user.role} variant={ROLE_VARIANT[user.role] ?? 'default'} />
                </td>

                {/* 状态 */}
                <td className="px-4 py-3">
                  <Badge label={STATUS_LABELS[user.status] ?? user.status} variant={STATUS_VARIANT[user.status] ?? 'default'} />
                  {user.rejectionReason && (
                    <p className="mt-1 max-w-[160px] truncate text-xs text-red-500" title={user.rejectionReason}>
                      {user.rejectionReason}
                    </p>
                  )}
                </td>

                {/* 注册时间 */}
                <td className="px-4 py-3 text-gray-600">{formatTime(user.createdAt)}</td>

                {/* 最后登录 */}
                <td className="px-4 py-3 text-gray-600">{formatTime(user.lastLoginAt)}</td>

                {/* 操作 */}
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {user.status === 'pending' && (
                      <>
                        <ActionButton variant="success" onClick={() => onAction({ type: 'approve', user })}>
                          批准
                        </ActionButton>
                        <ActionButton variant="danger" onClick={() => onAction({ type: 'reject', user })}>
                          拒绝
                        </ActionButton>
                      </>
                    )}
                    {user.status === 'active' && (
                      <>
                        <ActionButton variant="default" onClick={() => onAction({ type: 'changeRole', user })}>
                          改角色
                        </ActionButton>
                        <ActionButton variant="danger" onClick={() => onAction({ type: 'disable', user })}>
                          禁用
                        </ActionButton>
                      </>
                    )}
                    {user.status === 'disabled' && (
                      <ActionButton variant="success" onClick={() => onAction({ type: 'enable', user })}>
                        启用
                      </ActionButton>
                    )}
                    {user.status === 'rejected' && (
                      <ActionButton variant="success" onClick={() => onAction({ type: 'approve', user })}>
                        重新批准
                      </ActionButton>
                    )}
                    <ActionButton variant="danger" onClick={() => onAction({ type: 'delete', user })}>
                      删除
                    </ActionButton>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
