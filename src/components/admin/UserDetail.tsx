'use client';

import { useState } from 'react';
import { Badge } from '@/components/common';
import type { UserSummary } from '@/modules/users/types';

type ModalMode =
  | { type: 'reject'; user: UserSummary }
  | { type: 'changeRole'; user: UserSummary }
  | { type: 'detail'; user: UserSummary };

interface UserDetailProps {
  mode: ModalMode;
  onClose: () => void;
  onConfirm: (data: { reason?: string; role?: string }) => void;
}

const ROLE_OPTIONS = [
  { value: 'user', label: '普通用户' },
  { value: 'knowledge_admin', label: '知识管理员' },
  { value: 'admin', label: '管理员' },
];

const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  knowledge_admin: '知识管理员',
  user: '普通用户',
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
  return new Date(iso).toLocaleString('zh-CN');
}

export function UserDetail({ mode, onClose, onConfirm }: UserDetailProps) {
  const [reason, setReason] = useState('');
  const [selectedRole, setSelectedRole] = useState(mode.user.role);
  const [submitting, setSubmitting] = useState(false);

  const user = mode.user;

  async function handleSubmit() {
    if (mode.type === 'reject' && !reason.trim()) return;
    if (mode.type === 'changeRole' && selectedRole === user.role) return;

    setSubmitting(true);
    try {
      if (mode.type === 'reject') {
        onConfirm({ reason: reason.trim() });
      } else if (mode.type === 'changeRole') {
        onConfirm({ role: selectedRole });
      } else {
        onConfirm({});
      }
    } finally {
      setSubmitting(false);
    }
  }

  const titles: Record<string, string> = {
    reject: `拒绝用户 — ${user.username}`,
    changeRole: `修改角色 — ${user.username}`,
    detail: `用户详情 — ${user.username}`,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-lg rounded-card bg-white p-6 shadow-pop"
      >
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-semibold text-gray-900">{titles[mode.type]}</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none"
            aria-label="关闭"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 用户基本信息 */}
        <div className="mt-4 rounded-lg bg-gray-50 p-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-gray-500">用户名</dt>
            <dd className="font-medium text-gray-900">{user.username}</dd>
            <dt className="text-gray-500">ID</dt>
            <dd className="truncate font-mono text-xs text-gray-600">{user.id}</dd>
            <dt className="text-gray-500">当前角色</dt>
            <dd>{ROLE_LABELS[user.role] ?? user.role}</dd>
            <dt className="text-gray-500">状态</dt>
            <dd>
              <Badge label={STATUS_LABELS[user.status] ?? user.status} variant={STATUS_VARIANT[user.status] ?? 'default'} />
            </dd>
            <dt className="text-gray-500">注册时间</dt>
            <dd className="text-gray-700">{formatTime(user.createdAt)}</dd>
            <dt className="text-gray-500">最后登录</dt>
            <dd className="text-gray-700">{formatTime(user.lastLoginAt)}</dd>
            {user.registrationReason && (
              <>
                <dt className="text-gray-500">注册原因</dt>
                <dd className="text-gray-700">{user.registrationReason}</dd>
              </>
            )}
            {user.rejectionReason && (
              <>
                <dt className="text-gray-500">拒绝原因</dt>
                <dd className="text-red-600">{user.rejectionReason}</dd>
              </>
            )}
          </dl>
        </div>

        {/* 拒绝表单 */}
        {mode.type === 'reject' && (
          <div className="mt-4">
            <label htmlFor="reject-reason" className="block text-sm font-medium text-gray-700">
              拒绝原因 <span className="text-red-500">*</span>
            </label>
            <textarea
              id="reject-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="请输入拒绝该用户的理由…"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
            />
          </div>
        )}

        {/* 角色选择 */}
        {mode.type === 'changeRole' && (
          <div className="mt-4">
            <label htmlFor="role-select" className="block text-sm font-medium text-gray-700">
              新角色
            </label>
            <select
              id="role-select"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 底部操作 */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          >
            取消
          </button>
          {mode.type !== 'detail' && (
            <button
              type="button"
              disabled={
                submitting ||
                (mode.type === 'reject' && !reason.trim()) ||
                (mode.type === 'changeRole' && selectedRole === user.role)
              }
              onClick={handleSubmit}
              className={`inline-flex min-h-[44px] items-center justify-center rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${
                mode.type === 'reject'
                  ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                  : 'bg-brand-600 hover:bg-brand-700 focus:ring-brand-500'
              }`}
            >
              {submitting ? '处理中…' : mode.type === 'reject' ? '确认拒绝' : '确认修改'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
