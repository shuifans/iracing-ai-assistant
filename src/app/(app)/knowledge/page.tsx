'use client';

import { useState, useEffect, useCallback, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Tabs,
  Pagination,
  FilterBar,
  ConfirmDialog,
  Toast,
  DataTable,
  Button,
  PageHeader,
} from '@/components/common';
import { RequireRole } from '@/components/providers/RequireRole';
import { authFetch } from '@/lib/auth-client';
import { JobStatusBadge } from '@/components/knowledge/JobStatusBadge';
import { ItemTable } from '@/components/knowledge/ItemTable';
import { ItemContentModal } from '@/components/knowledge/ItemContentModal';
import { WebSourceManager } from '@/components/knowledge/WebSourceManager';
import { AddKnowledgeModal } from '@/components/knowledge/AddKnowledgeModal';
import {
  WorkflowBoard,
  STAGE_JOB_STATUSES,
  type WorkflowStage,
} from '@/components/knowledge/WorkflowBoard';
import type { JobStatus } from '@/config/constants';
import { JOB_STATUSES, KNOWLEDGE_CATEGORIES } from '@/config/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Job {
  id: string;
  sourceId: string;
  sourceName?: string | null;
  sourceInputType?: string | null;
  status: JobStatus;
  attempt: number;
  maxAttempts: number;
  progress: number;
  jobKind?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  [key: string]: unknown;
}

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

interface Draft {
  id: string;
  title: string;
  category: string | null;
  subcategory: string | null;
  sourceName: string | null;
  tier: string | null;
  overallScore: number | null;
  status: string;
  jobStatus: string | null;
  version: number;
  reCleanCount: number;
  reviewedAt: string | null;
  createdAt: string;
  [key: string]: unknown;
}

interface KnowledgeStats {
  items: { byStatus: { key: string; count: number }[]; total: number };
  workflow: {
    imported: number;
    cleaning: number;
    pendingReview: number;
    approvedPending: number;
  };
  [key: string]: unknown;
}

const TIER_BADGE: Record<string, string> = {
  A: 'bg-green-100 text-green-800',
  B: 'bg-blue-100 text-blue-800',
  C: 'bg-yellow-100 text-yellow-800',
  D: 'bg-red-100 text-red-800',
  pending: 'bg-gray-100 text-gray-600',
};

// 导入知识 tab 默认展示的（未完成）任务状态集合
const IMPORT_DEFAULT_STATUSES =
  'queued,paused,extracting,cleaning,pending_review,approved,failed';

// 终态任务（可删除）
const TERMINAL_JOB_STATUSES: JobStatus[] = ['published', 'rejected', 'failed', 'cancelled'];

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function KnowledgePage() {
  return (
    <RequireRole roles={['admin', 'knowledge_admin']}>
      <KnowledgePageContent />
    </RequireRole>
  );
}

function KnowledgePageContent() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('import');
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // ── Stats（工作流看板计数） ────────────────────────────────────────────────
  const [stats, setStats] = useState<KnowledgeStats | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await authFetch(`/api/knowledge/stats`);
      if (!res.ok) throw new Error('加载统计失败');
      const json = (await res.json()) as { data: { stats: KnowledgeStats } };
      setStats(json.data.stats);
    } catch {
      /* toast handled elsewhere */
    }
  }, []);

  // ── Jobs（导入知识 / 管理任务共用） ─────────────────────────────────────────
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsCursor, setJobsCursor] = useState<string | null>(null);
  const [jobsCursorStack, setJobsCursorStack] = useState<(string | null)[]>([]);
  // 导入知识：工作流阶段过滤；管理任务：单状态过滤
  const [activeStage, setActiveStage] = useState<WorkflowStage | null>(null);
  const [jobStatusFilter, setJobStatusFilter] = useState('');

  const importStatusParam = activeStage
    ? STAGE_JOB_STATUSES[activeStage]
    : IMPORT_DEFAULT_STATUSES;

  const fetchJobs = useCallback(async (cursor?: string, status?: string) => {
    setJobsLoading(true);
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (cursor) params.set('cursor', cursor);
      if (status) params.set('status', status);
      const res = await authFetch(`/api/knowledge/jobs?${params.toString()}`);
      if (!res.ok) throw new Error('加载任务失败');
      const json = (await res.json()) as {
        data: { jobs: Job[] };
        meta?: { nextCursor: string | null };
      };
      setJobs(json.data.jobs);
      setJobsCursor(json.meta?.nextCursor ?? null);
    } catch {
      /* toast handled by actions */
    } finally {
      setJobsLoading(false);
    }
  }, []);

  // 当前 tab 对应的任务过滤参数
  const currentJobStatusParam =
    activeTab === 'import' ? importStatusParam : jobStatusFilter || undefined;

  const refreshJobs = useCallback(() => {
    setJobsCursorStack([]);
    fetchJobs(
      undefined,
      activeTab === 'import' ? importStatusParam : jobStatusFilter || undefined,
    );
    fetchStats();
  }, [activeTab, importStatusParam, jobStatusFilter, fetchJobs, fetchStats]);

  // ── 管理知识：待发布 drafts ────────────────────────────────────────────────
  const [pendingDrafts, setPendingDrafts] = useState<Draft[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingCursor, setPendingCursor] = useState<string | null>(null);
  const [pendingCursorStack, setPendingCursorStack] = useState<(string | null)[]>([]);

  const fetchPendingDrafts = useCallback(async (cursor?: string) => {
    setPendingLoading(true);
    try {
      const params = new URLSearchParams({ limit: '20', pendingPublish: '1' });
      if (cursor) params.set('cursor', cursor);
      const res = await authFetch(`/api/knowledge/drafts?${params.toString()}`);
      if (!res.ok) throw new Error('加载待发布列表失败');
      const json = (await res.json()) as {
        data: { drafts: Draft[] };
        meta?: { nextCursor: string | null };
      };
      setPendingDrafts(json.data.drafts);
      setPendingCursor(json.meta?.nextCursor ?? null);
    } catch {
      /* toast handled by actions */
    } finally {
      setPendingLoading(false);
    }
  }, []);

  // ── 管理知识：已发布 items ────────────────────────────────────────────────
  const [manageView, setManageView] = useState<'pending' | 'published' | 'web'>('pending');
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsCursor, setItemsCursor] = useState<string | null>(null);
  const [itemsCursorStack, setItemsCursorStack] = useState<(string | null)[]>([]);
  const [itemFilters, setItemFilters] = useState({ category: '', status: '' });
  const [contentItemId, setContentItemId] = useState<string | null>(null);

  const fetchItems = useCallback(async (cursor?: string, filters?: Record<string, string>) => {
    setItemsLoading(true);
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (cursor) params.set('cursor', cursor);
      if (filters?.category) params.set('category', filters.category);
      if (filters?.status) params.set('status', filters.status);
      const res = await authFetch(`/api/knowledge/items?${params.toString()}`);
      if (!res.ok) throw new Error('加载知识条目失败');
      const json = (await res.json()) as {
        data: { items: KnowledgeItem[] };
        meta?: { nextCursor: string | null };
      };
      setItems(json.data.items);
      setItemsCursor(json.meta?.nextCursor ?? null);
    } catch {
      /* toast handled by actions */
    } finally {
      setItemsLoading(false);
    }
  }, []);

  // ── 添加知识 modal ───────────────────────────────────────────────────────
  const [addModalOpen, setAddModalOpen] = useState(false);

  // ── Tab / 视图切换时拉数据 ─────────────────────────────────────────────────
  useEffect(() => {
    startTransition(() => {
      if (activeTab === 'import') {
        fetchStats();
        fetchJobs(undefined, importStatusParam);
      } else if (activeTab === 'manage') {
        if (manageView === 'pending') fetchPendingDrafts();
        else if (manageView === 'published') fetchItems(undefined, itemFilters);
      } else if (activeTab === 'tasks') {
        fetchJobs(undefined, jobStatusFilter || undefined);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, manageView, importStatusParam, jobStatusFilter]);

  // ── Job actions ─────────────────────────────────────────────────────────
  const jobAction = async (
    url: string,
    method: string,
    successMsg: string,
    errorMsg: string,
  ) => {
    try {
      const res = await authFetch(url, { method });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? errorMsg);
      }
      setToast({ message: successMsg, type: 'success' });
      refreshJobs();
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : errorMsg, type: 'error' });
    }
  };

  const retryJob = (id: string) =>
    jobAction(`/api/knowledge/jobs/${id}/retry`, 'POST', '任务已重新排队', '重试失败');
  const cancelJob = (id: string) =>
    jobAction(`/api/knowledge/jobs/${id}/cancel`, 'POST', '任务已取消', '取消失败');
  const pauseJob = (id: string) =>
    jobAction(`/api/knowledge/jobs/${id}/pause`, 'POST', '任务已暂停', '暂停失败');
  const resumeJob = (id: string) =>
    jobAction(`/api/knowledge/jobs/${id}/resume`, 'POST', '任务已恢复排队', '恢复失败');
  const deleteJob = (id: string) =>
    jobAction(`/api/knowledge/jobs/${id}`, 'DELETE', '任务已删除', '删除失败');

  // ── 待发布 draft actions ─────────────────────────────────────────────────
  const publishDraft = async (id: string) => {
    try {
      const res = await authFetch(`/api/knowledge/drafts/${id}/publish`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? '发布失败');
      }
      setToast({ message: '已发布上线', type: 'success' });
      fetchPendingDrafts();
      fetchStats();
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : '发布失败', type: 'error' });
    }
  };

  const unapproveDraft = async (id: string) => {
    try {
      const res = await authFetch(`/api/knowledge/drafts/${id}/unapprove`, { method: 'POST' });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? '退回失败');
      }
      setToast({ message: '已退回待审查', type: 'success' });
      fetchPendingDrafts();
      fetchStats();
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : '退回失败', type: 'error' });
    }
  };

  // ── Item actions ────────────────────────────────────────────────────────
  const itemAction = async (
    url: string,
    method: string,
    successMsg: string,
    errorMsg: string,
  ) => {
    try {
      const res = await authFetch(url, { method });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? errorMsg);
      }
      setToast({ message: successMsg, type: 'success' });
      fetchItems(undefined, itemFilters);
      fetchStats();
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : errorMsg, type: 'error' });
    }
  };

  const archiveItem = (id: string) =>
    itemAction(`/api/knowledge/items/${id}/archive`, 'POST', '条目已下线', '下线失败');
  const restoreItem = (id: string) =>
    itemAction(`/api/knowledge/items/${id}/restore`, 'POST', '条目已重新上线', '上线失败');
  const deleteItem = (id: string) =>
    itemAction(`/api/knowledge/items/${id}`, 'DELETE', '条目已删除', '删除失败');

  // 重新清洗：从已发布条目派生修订草稿，跳转审查页
  const reviseItem = async (id: string) => {
    try {
      const res = await authFetch(`/api/knowledge/items/${id}/revise`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID(), 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? j?.message ?? '重新清洗失败');
      }
      const json = await res.json();
      setContentItemId(null);
      router.push(`/knowledge/review/${json.data.draftId}`);
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : '重新清洗失败', type: 'error' });
    }
  };

  // ── Job 行操作按钮（按状态渲染） ─────────────────────────────────────────────
  const confirmThen = (title: string, message: string, action: () => void) =>
    setConfirmAction({
      title,
      message,
      onConfirm: () => {
        setConfirmAction(null);
        action();
      },
    });

  const renderJobActions = (job: Job) => (
    <div className="flex flex-wrap gap-2">
      {job.status === 'queued' && (
        <Button type="button" variant="secondary" size="sm" onClick={() => pauseJob(job.id)}>
          暂停
        </Button>
      )}
      {job.status === 'paused' && (
        <Button type="button" variant="secondary" size="sm" onClick={() => resumeJob(job.id)}>
          恢复
        </Button>
      )}
      {(job.status === 'queued' || job.status === 'paused') && (
        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={() =>
            confirmThen('取消任务', `确定要取消任务 ${job.id.slice(0, 8)} 吗？`, () =>
              cancelJob(job.id),
            )
          }
        >
          取消
        </Button>
      )}
      {job.status === 'failed' && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            confirmThen('重试任务', `确定要重试任务 ${job.id.slice(0, 8)} 吗？`, () =>
              retryJob(job.id),
            )
          }
        >
          重试
        </Button>
      )}
      {job.status === 'pending_review' && (
        <Button
          type="button"
          size="sm"
          onClick={() => router.push(`/knowledge/review/${job.id}`)}
        >
          去审查
        </Button>
      )}
      {job.status === 'approved' && (
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setActiveTab('manage');
            setManageView('pending');
          }}
        >
          去发布
        </Button>
      )}
      {TERMINAL_JOB_STATUSES.includes(job.status) && (
        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={() =>
            confirmThen(
              '删除任务',
              `确定要删除任务 ${job.id.slice(0, 8)} 吗？其草稿与评估记录将一并删除，不可恢复。`,
              () => deleteJob(job.id),
            )
          }
        >
          删除
        </Button>
      )}
    </div>
  );

  // ── Job 列定义 ───────────────────────────────────────────────────────────
  const jobColumns = [
    {
      key: 'sourceName',
      header: '名称',
      render: (job: Job) => (
        <span
          className="max-w-[240px] truncate font-medium text-gray-900"
          title={job.sourceName ?? job.sourceId}
        >
          {job.sourceName ?? `${job.sourceId.slice(0, 8)}…`}
        </span>
      ),
    },
    {
      key: 'sourceInputType',
      header: '来源类型',
      render: (job: Job) => (
        <span className="text-xs text-gray-600">
          {job.sourceInputType === 'file' ? '文件' : job.sourceInputType === 'url' ? 'URL' : '—'}
          {job.jobKind === 're_clean' ? ' · 重洗' : ''}
        </span>
      ),
    },
    {
      key: 'status',
      header: '状态',
      render: (job: Job) => <JobStatusBadge status={job.status} />,
    },
    {
      key: 'progress',
      header: '进度',
      render: (job: Job) => (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-brand-600 transition-all"
              style={{ width: `${job.progress}%` }}
            />
          </div>
          <span className="text-xs text-gray-500">{job.progress}%</span>
        </div>
      ),
    },
    {
      key: 'errorMessage',
      header: '错误信息',
      render: (job: Job) => (
        <span
          className="max-w-[200px] truncate text-xs text-red-500"
          title={job.errorMessage ?? ''}
        >
          {job.errorMessage ?? '—'}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: '提交时间',
      render: (job: Job) => (
        <span className="text-xs text-gray-500">{new Date(job.createdAt).toLocaleString()}</span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      render: renderJobActions,
    },
  ];

  // ── 待发布 draft 列定义 ───────────────────────────────────────────────────
  const pendingColumns = [
    {
      key: 'title',
      header: '标题',
      render: (d: Draft) => <span className="font-medium text-gray-900">{d.title}</span>,
    },
    {
      key: 'category',
      header: '分类',
      render: (d: Draft) => (
        <span className="text-gray-600">
          {d.category ? `${d.category}/${d.subcategory ?? ''}` : '—'}
        </span>
      ),
    },
    {
      key: 'tier',
      header: '评估等级',
      render: (d: Draft) => (
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            TIER_BADGE[d.tier ?? ''] ?? TIER_BADGE.pending
          }`}
        >
          {d.tier ?? '—'}
          {d.overallScore != null ? ` · ${d.overallScore}` : ''}
        </span>
      ),
    },
    {
      key: 'version',
      header: '版本',
      render: (d: Draft) => (
        <span className="text-xs text-gray-600">
          v{d.version}
          {d.reCleanCount > 0 ? `（重洗 ${d.reCleanCount} 次）` : ''}
        </span>
      ),
    },
    {
      key: 'reviewedAt',
      header: '通过时间',
      render: (d: Draft) => (
        <span className="text-xs text-gray-500">
          {d.reviewedAt ? new Date(d.reviewedAt).toLocaleString() : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      render: (d: Draft) => (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() =>
              confirmThen('发布上线', `确定要发布「${d.title}」吗？将写入知识库并同步 Wiki。`, () =>
                publishDraft(d.id),
              )
            }
          >
            发布上线
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => router.push(`/knowledge/review/${d.id}`)}
          >
            查看
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={() =>
              confirmThen('退回审查', `确定要将「${d.title}」退回待审查吗？`, () =>
                unapproveDraft(d.id),
              )
            }
          >
            退回审查
          </Button>
        </div>
      ),
    },
  ];

  // ── Filter 配置 ──────────────────────────────────────────────────────────
  const itemFilterConfig = [
    {
      name: 'category',
      label: '分类',
      type: 'select' as const,
      options: Object.keys(KNOWLEDGE_CATEGORIES).map((k) => ({ value: k, label: k })),
    },
    {
      name: 'status',
      label: '状态',
      type: 'select' as const,
      options: [
        { value: 'published', label: '已上线' },
        { value: 'archived', label: '已下线' },
      ],
    },
  ];

  const jobFilterConfig = [
    {
      name: 'status',
      label: '状态',
      type: 'select' as const,
      options: JOB_STATUSES.map((s) => ({ value: s, label: s })),
    },
  ];

  const jobsPagination = (
    <Pagination
      nextCursor={jobsCursor}
      hasPrev={jobsCursorStack.length > 0}
      onPrev={() => {
        const stack = [...jobsCursorStack];
        stack.pop();
        const prev = stack[stack.length - 1] ?? undefined;
        setJobsCursorStack(stack);
        fetchJobs(prev, currentJobStatusParam);
      }}
      onNext={(cursor) => {
        setJobsCursorStack([...jobsCursorStack, jobsCursor]);
        setJobsCursor(cursor);
        fetchJobs(cursor, currentJobStatusParam);
      }}
    />
  );

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {confirmAction && (
        <ConfirmDialog
          isOpen={true}
          title={confirmAction.title}
          message={confirmAction.message}
          onConfirm={confirmAction.onConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      <ItemContentModal
        itemId={contentItemId}
        onClose={() => setContentItemId(null)}
        onRevise={reviseItem}
      />

      <AddKnowledgeModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onSuccess={() => {
          setToast({ message: '知识已提交，进入导入工作流', type: 'success' });
          refreshJobs();
        }}
        onError={(msg) => setToast({ message: msg, type: 'error' })}
      />

      <PageHeader
        title="知识管理"
        description="导入知识、管理知识与管理任务"
        actions={
          activeTab === 'import' ? (
            <Button type="button" onClick={() => setAddModalOpen(true)}>
              + 添加知识
            </Button>
          ) : undefined
        }
      />

      {/* Tabs */}
      <div className="mt-4">
        <Tabs
          tabs={[
            { id: 'import', label: '导入知识' },
            { id: 'manage', label: '管理知识' },
            { id: 'tasks', label: '管理任务' },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
        />
      </div>

      {/* Tab content */}
      <div className="mt-6">
        {/* ── 导入知识 ─────────────────────────────────────────────────── */}
        {activeTab === 'import' && (
          <div className="space-y-6">
            <WorkflowBoard
              counts={stats?.workflow ?? null}
              activeStage={activeStage}
              onStageClick={(stage) => {
                setActiveStage(stage);
                setJobsCursorStack([]);
              }}
            />

            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700">
                {activeStage ? '当前阶段任务' : '进行中的知识'}
              </p>
              {activeStage && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveStage(null);
                    setJobsCursorStack([]);
                  }}
                  className="text-xs text-brand-600 hover:underline"
                >
                  清除阶段过滤
                </button>
              )}
            </div>

            <DataTable<Job>
              columns={jobColumns}
              data={jobs}
              loading={jobsLoading}
              emptyMessage="暂无进行中的知识，点击右上角「+ 添加知识」开始导入"
            />

            {jobsPagination}
          </div>
        )}

        {/* ── 管理知识 ─────────────────────────────────────────────────── */}
        {activeTab === 'manage' && (
          <div className="space-y-6">
            {/* 次级分区切换 */}
            <div className="flex gap-2">
              {(
                [
                  { id: 'pending', label: '待发布' },
                  { id: 'published', label: '已发布' },
                  { id: 'web', label: '联网知识源' },
                ] as const
              ).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setManageView(v.id)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/40 ${
                    manageView === v.id
                      ? 'bg-brand-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>

            {manageView === 'pending' && (
              <div className="space-y-6">
                <DataTable<Draft>
                  columns={pendingColumns}
                  data={pendingDrafts}
                  loading={pendingLoading}
                  emptyMessage="暂无待发布知识（在「导入知识」中通过审查后会出现在这里）"
                />
                <Pagination
                  nextCursor={pendingCursor}
                  hasPrev={pendingCursorStack.length > 0}
                  onPrev={() => {
                    const stack = [...pendingCursorStack];
                    stack.pop();
                    const prev = stack[stack.length - 1] ?? undefined;
                    setPendingCursorStack(stack);
                    fetchPendingDrafts(prev);
                  }}
                  onNext={(cursor) => {
                    setPendingCursorStack([...pendingCursorStack, pendingCursor]);
                    setPendingCursor(cursor);
                    fetchPendingDrafts(cursor);
                  }}
                />
              </div>
            )}

            {manageView === 'published' && (
              <div className="space-y-6">
                <FilterBar
                  filters={itemFilterConfig}
                  values={itemFilters}
                  onChange={(name, value) => {
                    setItemFilters({ ...itemFilters, [name]: value });
                  }}
                  onSearch={() => {
                    setItemsCursorStack([]);
                    fetchItems(undefined, itemFilters);
                  }}
                />

                <ItemTable
                  data={items}
                  loading={itemsLoading}
                  onViewContent={(id) => setContentItemId(id)}
                  onRevise={(id) =>
                    confirmThen(
                      '重新清洗',
                      '将从该条目派生修订草稿并进入审查流程，确定继续吗？',
                      () => reviseItem(id),
                    )
                  }
                  onArchive={(id) =>
                    confirmThen('下线条目', '确定要下线该知识条目吗？', () => archiveItem(id))
                  }
                  onRestore={(id) =>
                    confirmThen('重新上线', '确定要重新上线该知识条目吗？', () => restoreItem(id))
                  }
                  onDelete={(id) =>
                    confirmThen(
                      '删除条目',
                      '确定要永久删除该知识条目吗？Wiki 文件将一并删除，不可恢复。',
                      () => deleteItem(id),
                    )
                  }
                />

                <Pagination
                  nextCursor={itemsCursor}
                  hasPrev={itemsCursorStack.length > 0}
                  onPrev={() => {
                    const stack = [...itemsCursorStack];
                    stack.pop();
                    const prev = stack[stack.length - 1] ?? undefined;
                    setItemsCursorStack(stack);
                    fetchItems(prev, itemFilters);
                  }}
                  onNext={(cursor) => {
                    setItemsCursorStack([...itemsCursorStack, itemsCursor]);
                    setItemsCursor(cursor);
                    fetchItems(cursor, itemFilters);
                  }}
                />
              </div>
            )}

            {manageView === 'web' && <WebSourceManager />}
          </div>
        )}

        {/* ── 管理任务 ─────────────────────────────────────────────────── */}
        {activeTab === 'tasks' && (
          <div className="space-y-6">
            <FilterBar
              filters={jobFilterConfig}
              values={{ status: jobStatusFilter }}
              onChange={(name, value) => {
                if (name === 'status') {
                  setJobStatusFilter(value);
                  setJobsCursorStack([]);
                }
              }}
            />

            <DataTable<Job>
              columns={jobColumns}
              data={jobs}
              loading={jobsLoading}
              emptyMessage="暂无任务"
            />

            {jobsPagination}
          </div>
        )}
      </div>
    </div>
  );
}
