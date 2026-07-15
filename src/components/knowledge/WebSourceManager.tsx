'use client';

import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog, DataTable, Toast } from '@/components/common';
import { authFetch } from '@/lib/auth-client';
import type { WebKnowledgeSource } from '@/db/schema/web-sources';

type SourceRow = WebKnowledgeSource & Record<string, unknown>;
type ToastState = { message: string; type: 'success' | 'error' | 'info' } | null;
type SourceForm = Pick<
  WebKnowledgeSource,
  'name' | 'scopeType' | 'url' | 'sourceLevel' | 'enabled' | 'description'
>;

const EMPTY_FORM: SourceForm = {
  name: '',
  scopeType: 'domain',
  url: '',
  sourceLevel: 'official',
  enabled: true,
  description: '',
};

async function responseError(response: Response, fallback: string): Promise<string> {
  const json = (await response.json().catch(() => null)) as {
    error?: { message?: string };
    message?: string;
  } | null;
  return json?.error?.message ?? json?.message ?? fallback;
}

export function WebSourceManager() {
  const [sources, setSources] = useState<WebKnowledgeSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<SourceForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebKnowledgeSource | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  const loadSources = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch('/api/knowledge/web-sources');
      if (!response.ok) throw new Error('加载联网知识源失败');
      const json = (await response.json()) as { data: { sources: WebKnowledgeSource[] } };
      setSources(json.data.sources);
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : '加载联网知识源失败',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  async function toggleSource(source: WebKnowledgeSource) {
    try {
      const response = await authFetch(`/api/knowledge/web-sources/${source.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !source.enabled }),
      });
      if (!response.ok) throw new Error(await responseError(response, '更新联网知识源失败'));
      const json = (await response.json()) as { data: { source: WebKnowledgeSource } };
      setSources((current) =>
        current.map((item) => (item.id === json.data.source.id ? json.data.source : item)),
      );
      setToast({
        message: `已${json.data.source.enabled ? '启用' : '停用'} ${source.name}`,
        type: 'success',
      });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : '更新联网知识源失败',
        type: 'error',
      });
    }
  }

  function startEditing(source: WebKnowledgeSource) {
    setEditingId(source.id);
    setForm({
      name: source.name,
      scopeType: source.scopeType,
      url: source.url,
      sourceLevel: source.sourceLevel,
      enabled: source.enabled,
      description: source.description ?? '',
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function saveSource(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sourceName = form.name.trim();
    setSaving(true);
    try {
      const response = await authFetch(
        editingId ? `/api/knowledge/web-sources/${editingId}` : '/api/knowledge/web-sources',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...form,
            name: sourceName,
            url: form.url.trim(),
            description: form.description?.trim() || null,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await responseError(response, editingId ? '保存来源失败' : '创建来源失败'));
      }
      const json = (await response.json()) as { data: { source: WebKnowledgeSource } };
      setSources((current) =>
        editingId
          ? current.map((source) => (source.id === json.data.source.id ? json.data.source : source))
          : [...current, json.data.source],
      );
      setToast({ message: `${editingId ? '已保存' : '已创建'} ${sourceName}`, type: 'success' });
      resetForm();
    } catch (error) {
      setToast({
        message:
          error instanceof Error ? error.message : editingId ? '保存来源失败' : '创建来源失败',
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  async function deleteSource() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      const response = await authFetch(`/api/knowledge/web-sources/${target.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error(await responseError(response, '删除联网知识源失败'));
      setSources((current) => current.filter((source) => source.id !== target.id));
      if (editingId === target.id) resetForm();
      setToast({ message: `已删除 ${target.name}`, type: 'success' });
      setDeleteTarget(null);
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : '删除联网知识源失败',
        type: 'error',
      });
      setDeleteTarget(null);
    }
  }

  const columns = [
    { key: 'name', header: '名称' },
    {
      key: 'scopeType',
      header: '范围类型',
      render: (source: SourceRow) =>
        ({ domain: '域名', path: '路径', exact_url: '精确 URL' })[source.scopeType],
    },
    {
      key: 'url',
      header: 'URL',
      render: (source: SourceRow) => (
        <span className="break-all font-mono text-xs">{source.url}</span>
      ),
    },
    {
      key: 'sourceLevel',
      header: '来源级别',
      render: (source: SourceRow) => (source.sourceLevel === 'official' ? '官方' : '社区'),
    },
    {
      key: 'description',
      header: '说明',
      render: (source: SourceRow) => source.description || '—',
    },
    {
      key: 'enabled',
      header: '状态',
      render: (source: SourceRow) => (source.enabled ? '已启用' : '已停用'),
    },
    {
      key: 'actions',
      header: '操作',
      render: (source: SourceRow) => (
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            aria-label={`${source.enabled ? '停用' : '启用'} ${source.name}`}
            onClick={() => void toggleSource(source)}
            className="rounded-md px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            {source.enabled ? '停用' : '启用'}
          </button>
          <button
            type="button"
            aria-label={`编辑 ${source.name}`}
            onClick={() => startEditing(source)}
            className="rounded-md px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            编辑
          </button>
          <button
            type="button"
            aria-label={`删除 ${source.name}`}
            onClick={() => setDeleteTarget(source)}
            className="rounded-md px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500/40"
          >
            删除
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <form
        onSubmit={(event) => void saveSource(event)}
        className="rounded-xl border border-gray-200 bg-white p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            {editingId ? '编辑联网知识源' : '新增联网知识源'}
          </h2>
          {editingId && (
            <button
              type="button"
              aria-label={`取消编辑 ${form.name}`}
              onClick={resetForm}
              className="rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            >
              取消编辑
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="text-sm font-medium text-gray-700">
            名称
            <input
              required
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </label>

          <label className="text-sm font-medium text-gray-700">
            范围类型
            <select
              value={form.scopeType}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  scopeType: event.target.value as SourceForm['scopeType'],
                }))
              }
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="domain">域名</option>
              <option value="path">路径</option>
              <option value="exact_url">精确 URL</option>
            </select>
          </label>

          <label className="text-sm font-medium text-gray-700">
            URL
            <input
              required
              type="url"
              value={form.url}
              onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
              placeholder="https://example.com"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </label>

          <label className="text-sm font-medium text-gray-700">
            来源级别
            <select
              value={form.sourceLevel}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  sourceLevel: event.target.value as SourceForm['sourceLevel'],
                }))
              }
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="official">官方</option>
              <option value="community">社区</option>
            </select>
          </label>

          <label className="flex min-h-[44px] items-center gap-2 self-end text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) =>
                setForm((current) => ({ ...current, enabled: event.target.checked }))
              }
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            启用状态
          </label>

          <label className="text-sm font-medium text-gray-700 md:col-span-2 xl:col-span-3">
            说明
            <textarea
              value={form.description ?? ''}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
              rows={2}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </label>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            aria-label={`${editingId ? '保存' : '创建'} ${form.name || '新来源'}`}
            className="inline-flex min-h-[44px] items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? '保存中…' : editingId ? '保存修改' : '创建来源'}
          </button>
        </div>
      </form>

      <DataTable<SourceRow>
        columns={columns}
        data={sources as SourceRow[]}
        loading={loading}
        emptyMessage="暂无联网知识源"
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="删除联网知识源"
        message={`确定要删除“${deleteTarget?.name ?? ''}”吗？此操作无法撤销。`}
        confirmLabel="确认删除"
        danger
        onConfirm={() => void deleteSource()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
