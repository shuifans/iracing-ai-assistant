'use client';

import { useState, useEffect, useCallback } from 'react';
import { Tabs, FilterBar, ConfirmDialog, Toast, Pagination } from '@/components/common';
import { UserTable } from '@/components/admin/UserTable';
import { UserDetail } from '@/components/admin/UserDetail';
import { authFetch } from '@/lib/auth-client';
import type { UserSummary } from '@/modules/users/types';

// ── Types ────────────────────────────────────────────────────────────────────

type UserAction =
  | { type: 'approve'; user: UserSummary }
  | { type: 'reject'; user: UserSummary }
  | { type: 'disable'; user: UserSummary }
  | { type: 'enable'; user: UserSummary }
  | { type: 'changeRole'; user: UserSummary }
  | { type: 'delete'; user: UserSummary };

interface ToastState {
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ModalState {
  type: 'reject' | 'changeRole' | 'detail';
  user: UserSummary;
}

interface ConfirmState {
  type: 'disable' | 'enable' | 'delete' | 'approve';
  user: UserSummary;
}

// ── Constants ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'pending', label: '待审批' },
  { id: 'all', label: '全部用户' },
];

const FILTERS = [
  {
    name: 'role',
    label: '角色',
    type: 'select' as const,
    options: [
      { value: 'admin', label: '管理员' },
      { value: 'knowledge_admin', label: '知识管理员' },
      { value: 'user', label: '普通用户' },
    ],
  },
  {
    name: 'status',
    label: '状态',
    type: 'select' as const,
    options: [
      { value: 'active', label: '正常' },
      { value: 'pending', label: '待审批' },
      { value: 'disabled', label: '已禁用' },
      { value: 'rejected', label: '已拒绝' },
    ],
  },
  {
    name: 'search',
    label: '搜索',
    type: 'text' as const,
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

async function apiCall(url: string, options?: RequestInit): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await authFetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const msg =
        (body as { error?: { message?: string } } | null)?.error?.message ??
        `请求失败 (${res.status})`;
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ── Custom hook ──────────────────────────────────────────────────────────────

function useUsers(activeTab: string, filterValues: Record<string, string>, cursor: string | undefined, refreshTrigger: number) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchUsers() {
      setLoading(true);
      try {
        if (activeTab === 'pending') {
          const res = await authFetch('/api/admin/users/pending');
          if (cancelled) return;
          if (res.ok) {
            const json = (await res.json()) as { data: { users: UserSummary[] } };
            setUsers(json.data.users);
          } else {
            setUsers([]);
          }
        } else {
          const params = new URLSearchParams();
          params.set('limit', '20');
          if (filterValues.role) params.set('role', filterValues.role);
          if (filterValues.status) params.set('status', filterValues.status);
          if (filterValues.search) params.set('search', filterValues.search);
          if (cursor) params.set('cursor', cursor);

          const res = await authFetch(`/api/admin/users?${params.toString()}`);
          if (cancelled) return;
          if (res.ok) {
            const json = (await res.json()) as {
              data: { users: UserSummary[] };
              pagination?: { nextCursor: string | null };
            };
            setUsers(json.data.users);
          } else {
            setUsers([]);
          }
        }
      } catch {
        if (!cancelled) setUsers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchUsers();
    return () => {
      cancelled = true;
    };
  }, [activeTab, filterValues, cursor, refreshTrigger]);

  return { users, loading };
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const [activeTab, setActiveTab] = useState('pending');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Modal / dialog state
  const [modal, setModal] = useState<ModalState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const currentCursor = cursorStack.length > 0 ? cursorStack[cursorStack.length - 1] : undefined;
  const { users, loading } = useUsers(activeTab, filterValues, currentCursor, refreshTrigger);

  function refreshList() {
    setCursorStack([]);
    setNextCursor(null);
    setRefreshTrigger((t) => t + 1);
  }

  // ── Action handlers ────────────────────────────────────────────────────────

  function handleAction(action: UserAction) {
    if (action.type === 'reject') {
      setModal({ type: 'reject', user: action.user });
    } else if (action.type === 'changeRole') {
      setModal({ type: 'changeRole', user: action.user });
    } else if (action.type === 'approve' || action.type === 'disable' || action.type === 'enable' || action.type === 'delete') {
      setConfirm({ type: action.type, user: action.user });
    }
  }

  async function executeConfirm() {
    if (!confirm) return;
    const { type, user } = confirm;
    setConfirm(null);

    if (type === 'approve') {
      const result = await apiCall(`/api/admin/users/${user.id}/approve`, { method: 'POST' });
      setToast(result.ok
        ? { message: `已批准用户 ${user.username}`, type: 'success' }
        : { message: result.error ?? '批准失败', type: 'error' }
      );
    } else if (type === 'disable') {
      const result = await apiCall(`/api/admin/users/${user.id}/disable`, { method: 'POST' });
      setToast(result.ok
        ? { message: `已禁用用户 ${user.username}`, type: 'success' }
        : { message: result.error ?? '禁用失败', type: 'error' }
      );
    } else if (type === 'enable') {
      const result = await apiCall(`/api/admin/users/${user.id}/enable`, { method: 'POST' });
      setToast(result.ok
        ? { message: `已启用用户 ${user.username}`, type: 'success' }
        : { message: result.error ?? '启用失败', type: 'error' }
      );
    } else if (type === 'delete') {
      const result = await apiCall(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      setToast(result.ok
        ? { message: `已删除用户 ${user.username}`, type: 'success' }
        : { message: result.error ?? '删除失败', type: 'error' }
      );
    }

    setRefreshTrigger((t) => t + 1);
  }

  async function executeModal(data: { reason?: string; role?: string }) {
    if (!modal) return;
    const currentModal = modal;
    setModal(null);

    if (currentModal.type === 'reject') {
      const result = await apiCall(`/api/admin/users/${currentModal.user.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: data.reason ?? '' }),
      });
      setToast(result.ok
        ? { message: `已拒绝用户 ${currentModal.user.username}`, type: 'success' }
        : { message: result.error ?? '拒绝失败', type: 'error' }
      );
    } else if (currentModal.type === 'changeRole') {
      const result = await apiCall(`/api/admin/users/${currentModal.user.id}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role: data.role ?? 'user' }),
      });
      setToast(result.ok
        ? { message: `已修改 ${currentModal.user.username} 的角色`, type: 'success' }
        : { message: result.error ?? '修改角色失败', type: 'error' }
      );
    }

    setRefreshTrigger((t) => t + 1);
  }

  // ── Pagination ─────────────────────────────────────────────────────────────

  function handleNext(cursor: string) {
    setCursorStack((prev) => [...prev, cursor]);
  }

  function handlePrev() {
    setCursorStack((prev) => {
      const next = [...prev];
      next.pop();
      return next;
    });
  }

  // ── Confirm dialog messages ────────────────────────────────────────────────

  const confirmMessages: Record<string, { title: string; message: string; danger: boolean; label: string }> = {
    approve: {
      title: '确认批准',
      message: confirm ? `确定要批准用户 "${confirm.user.username}" 吗？` : '',
      danger: false,
      label: '批准',
    },
    disable: {
      title: '确认禁用',
      message: confirm ? `确定要禁用用户 "${confirm.user.username}" 吗？禁用后该用户将无法登录。` : '',
      danger: true,
      label: '禁用',
    },
    enable: {
      title: '确认启用',
      message: confirm ? `确定要重新启用用户 "${confirm.user.username}" 吗？` : '',
      danger: false,
      label: '启用',
    },
    delete: {
      title: '确认删除',
      message: confirm
        ? `确定要永久删除用户 "${confirm.user.username}" 吗？此操作不可撤销，所有关联数据（会话、消息等）也将被删除。`
        : '',
      danger: true,
      label: '永久删除',
    },
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">用户管理</h1>
        <p className="mt-1 text-sm text-gray-500">管理系统用户：审批注册、修改角色、禁用或删除账户</p>
      </div>

      {/* Tabs */}
      <Tabs
        tabs={TABS}
        activeTab={activeTab}
        onChange={(id) => {
          setActiveTab(id);
          setFilterValues({});
        }}
      />

      {/* Filters (all tab only) */}
      {activeTab === 'all' && (
        <FilterBar
          filters={FILTERS}
          values={filterValues}
          onChange={(name, value) =>
            setFilterValues((prev) => ({ ...prev, [name]: value }))
          }
          onSearch={refreshList}
        />
      )}

      {/* User table */}
      <UserTable users={users} loading={loading} onAction={handleAction} />

      {/* Pagination (all tab only) */}
      {activeTab === 'all' && (
        <Pagination
          nextCursor={nextCursor}
          hasPrev={cursorStack.length > 0}
          onPrev={handlePrev}
          onNext={handleNext}
        />
      )}

      {/* Confirm dialog */}
      {confirm && (() => {
        const msg = confirmMessages[confirm.type] ?? confirmMessages.delete!;
        return (
          <ConfirmDialog
            isOpen={true}
            title={msg.title}
            message={msg.message}
            confirmLabel={msg.label}
            danger={msg.danger}
            onConfirm={executeConfirm}
            onCancel={() => setConfirm(null)}
          />
        );
      })()}

      {/* Modal (reject / changeRole) */}
      {modal && (
        <UserDetail
          mode={modal}
          onClose={() => setModal(null)}
          onConfirm={executeModal}
        />
      )}

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
