'use client';

import { useState, useEffect, useCallback, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Tabs, Pagination, FilterBar, ConfirmDialog, Toast, StatCard } from '@/components/common';
import { DataTable } from '@/components/common';
import { authFetch } from '@/lib/auth-client';
import { SourceUploadForm } from '@/components/knowledge/SourceUploadForm';
import { CleaningBackendSwitch } from '@/components/knowledge/CleaningBackendSwitch';
import { JobStatusBadge, SourceStatusBadge } from '@/components/knowledge/JobStatusBadge';
import { ItemTable } from '@/components/knowledge/ItemTable';
import { ItemContentModal } from '@/components/knowledge/ItemContentModal';
import type { JobStatus } from '@/config/constants';
import { JOB_STATUSES, KNOWLEDGE_CATEGORIES, EVALUATION_TIERS, EVALUATION_STATUSES, DRAFT_STATUSES } from '@/config/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Source {
  id: string;
  inputType: string;
  originalName?: string | null;
  sourceUrl?: string | null;
  status: 'stored' | 'queued' | 'processing' | 'ready' | 'failed' | 'archived';
  createdAt: string;
  [key: string]: unknown;
}

interface Job {
  id: string;
  sourceId: string;
  status: JobStatus;
  attempt: number;
  maxAttempts: number;
  progress: number;
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

interface Evaluation {
  id: string;
  draftId: string;
  tier: string;
  overallScore: number;
  status: string;
  deepEval: boolean;
  createdAt: string;
  updatedAt: string;
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
  version: number;
  reCleanCount: number;
  createdAt: string;
  [key: string]: unknown;
}

interface StatsBucket {
  key: string;
  count: number;
}

interface KnowledgeStats {
  items: { byStatus: StatsBucket[]; byCategory: StatsBucket[]; total: number };
  drafts: { byStatus: StatsBucket[]; reviewQueue: number; total: number };
  sources: { total: number };
  jobs: { byStatus: StatsBucket[] };
  reClean: { jobsTotal: number; byVersion: { version: number; count: number }[] };
  tierDistribution: StatsBucket[];
}

// ---------------------------------------------------------------------------
// Custom hook for tab-based data fetching
// ---------------------------------------------------------------------------

function useKnowledgePageData() {
  const [activeTab, setActiveTab] = useState('overview');

  // ── Sources ─────────────────────────────────────────────────────────────
  const [sources, setSources] = useState<Source[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesCursor, setSourcesCursor] = useState<string | null>(null);
  const [sourcesCursorStack, setSourcesCursorStack] = useState<(string | null)[]>([]);

  const fetchSources = useCallback(async (cursor?: string) => {
    setSourcesLoading(true);
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (cursor) params.set('cursor', cursor);
      const res = await authFetch(`/api/knowledge/sources?${params.toString()}`);
      if (!res.ok) throw new Error('加载来源失败');
      const json = (await res.json()) as {
        data: { sources: Source[] };
        meta?: { nextCursor: string | null };
      };
      setSources(json.data.sources);
      setSourcesCursor(json.meta?.nextCursor ?? null);
    } catch {
      // handled by toast in component
    } finally {
      setSourcesLoading(false);
    }
  }, []);

  // ── Jobs ────────────────────────────────────────────────────────────────
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsCursor, setJobsCursor] = useState<string | null>(null);
  const [jobsCursorStack, setJobsCursorStack] = useState<(string | null)[]>([]);
  const [jobStatusFilter, setJobStatusFilter] = useState('');

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
      // handled by toast in component
    } finally {
      setJobsLoading(false);
    }
  }, []);

  // ── Items ───────────────────────────────────────────────────────────────
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsCursor, setItemsCursor] = useState<string | null>(null);
  const [itemsCursorStack, setItemsCursorStack] = useState<(string | null)[]>([]);
  const [itemFilters, setItemFilters] = useState({ category: '', status: '' });

  // ── Evaluations (评估 / 反馈 tabs share this data source) ────────────────
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [evaluationsLoading, setEvaluationsLoading] = useState(false);
  const [evaluationsCursor, setEvaluationsCursor] = useState<string | null>(null);
  const [evaluationsCursorStack, setEvaluationsCursorStack] = useState<(string | null)[]>([]);
  const [evalTierFilter, setEvalTierFilter] = useState('');
  const [evalStatusFilter, setEvalStatusFilter] = useState('');

  const fetchEvaluations = useCallback(async (cursor?: string, tier?: string, status?: string) => {
    setEvaluationsLoading(true);
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (cursor) params.set('cursor', cursor);
      if (tier) params.set('tier', tier);
      if (status) params.set('status', status);
      const res = await authFetch(`/api/knowledge/evaluations?${params.toString()}`);
      if (!res.ok) throw new Error('加载评估失败');
      const json = (await res.json()) as {
        data: { evaluations: Evaluation[] };
        meta?: { nextCursor: string | null };
      };
      setEvaluations(json.data.evaluations);
      setEvaluationsCursor(json.meta?.nextCursor ?? null);
    } catch {
      // handled by toast in component
    } finally {
      setEvaluationsLoading(false);
    }
  }, []);

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
      // handled by toast in component
    } finally {
      setItemsLoading(false);
    }
  }, []);

  // ── Drafts (候选稿 — cleaned drafts pending review) ───────────────────────
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftsCursor, setDraftsCursor] = useState<string | null>(null);
  const [draftsCursorStack, setDraftsCursorStack] = useState<(string | null)[]>([]);
  const [draftFilters, setDraftFilters] = useState({ status: '', tier: '' });

  const fetchDrafts = useCallback(async (cursor?: string, filters?: Record<string, string>) => {
    setDraftsLoading(true);
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (cursor) params.set('cursor', cursor);
      if (filters?.status) params.set('status', filters.status);
      if (filters?.tier) params.set('tier', filters.tier);
      const res = await authFetch(`/api/knowledge/drafts?${params.toString()}`);
      if (!res.ok) throw new Error('加载候选稿失败');
      const json = (await res.json()) as {
        data: { drafts: Draft[] };
        meta?: { nextCursor: string | null };
      };
      setDrafts(json.data.drafts);
      setDraftsCursor(json.meta?.nextCursor ?? null);
    } catch {
      // handled by toast in component
    } finally {
      setDraftsLoading(false);
    }
  }, []);

  // ── Stats (概览 dashboard) ────────────────────────────────────────────────
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await authFetch(`/api/knowledge/stats`);
      if (!res.ok) throw new Error('加载统计失败');
      const json = (await res.json()) as { data: { stats: KnowledgeStats } };
      setStats(json.data.stats);
    } catch {
      // handled by toast in component
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // ── Tab change ──────────────────────────────────────────────────────────
  useEffect(() => {
    startTransition(() => {
      if (activeTab === 'overview') fetchStats();
      else if (activeTab === 'sources') fetchSources();
      else if (activeTab === 'jobs') fetchJobs(undefined, jobStatusFilter || undefined);
      else if (activeTab === 'items') fetchItems(undefined, itemFilters);
      else if (activeTab === 'drafts') fetchDrafts(undefined, draftFilters);
      else if (activeTab === 'evaluations' || activeTab === 'feedback')
        fetchEvaluations(undefined, evalTierFilter || undefined, evalStatusFilter || undefined);
    });
  }, [
    activeTab,
    fetchStats,
    fetchSources,
    fetchJobs,
    fetchItems,
    fetchDrafts,
    fetchEvaluations,
    jobStatusFilter,
    itemFilters,
    draftFilters,
    evalTierFilter,
    evalStatusFilter,
  ]);

  return {
    activeTab, setActiveTab,
    sources, sourcesLoading, sourcesCursor, sourcesCursorStack, setSourcesCursor, setSourcesCursorStack,
    jobs, jobsLoading, jobsCursor, jobsCursorStack, setJobsCursor, setJobsCursorStack,
    jobStatusFilter, setJobStatusFilter,
    items, itemsLoading, itemsCursor, itemsCursorStack, setItemsCursor, setItemsCursorStack,
    itemFilters, setItemFilters,
    drafts, draftsLoading, draftsCursor, draftsCursorStack, setDraftsCursor, setDraftsCursorStack,
    draftFilters, setDraftFilters,
    stats, statsLoading,
    evaluations, evaluationsLoading, evaluationsCursor, evaluationsCursorStack,
    setEvaluationsCursor, setEvaluationsCursorStack,
    evalTierFilter, setEvalTierFilter, evalStatusFilter, setEvalStatusFilter,
    fetchSources, fetchJobs, fetchItems, fetchDrafts, fetchStats, fetchEvaluations,
  };
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function KnowledgePage() {
  const router = useRouter();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const {
    activeTab, setActiveTab,
    sources, sourcesLoading, sourcesCursor, sourcesCursorStack, setSourcesCursor, setSourcesCursorStack,
    jobs, jobsLoading, jobsCursor, jobsCursorStack, setJobsCursor, setJobsCursorStack,
    jobStatusFilter, setJobStatusFilter,
    items, itemsLoading, itemsCursor, itemsCursorStack, setItemsCursor, setItemsCursorStack,
    itemFilters, setItemFilters,
    drafts, draftsLoading, draftsCursor, draftsCursorStack, setDraftsCursor, setDraftsCursorStack,
    draftFilters, setDraftFilters,
    stats, statsLoading,
    evaluations, evaluationsLoading, evaluationsCursor, evaluationsCursorStack,
    setEvaluationsCursor, setEvaluationsCursorStack,
    evalTierFilter, setEvalTierFilter, evalStatusFilter, setEvalStatusFilter,
    fetchSources, fetchJobs, fetchItems, fetchDrafts, fetchStats, fetchEvaluations,
  } = useKnowledgePageData();

  // ── Job actions ─────────────────────────────────────────────────────────
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // Item whose published body is shown in the content modal (null = closed).
  const [contentItemId, setContentItemId] = useState<string | null>(null);

  const retryJob = async (id: string) => {
    try {
      const res = await authFetch(`/api/knowledge/jobs/${id}/retry`, { method: 'POST' });
      if (!res.ok) throw new Error('重试失败');
      setToast({ message: '任务已重新排队', type: 'success' });
      fetchJobs(undefined, jobStatusFilter || undefined);
    } catch {
      setToast({ message: '重试失败', type: 'error' });
    }
  };

  const cancelJob = async (id: string) => {
    try {
      const res = await authFetch(`/api/knowledge/jobs/${id}/cancel`, { method: 'POST' });
      if (!res.ok) throw new Error('取消失败');
      setToast({ message: '任务已取消', type: 'success' });
      fetchJobs(undefined, jobStatusFilter || undefined);
    } catch {
      setToast({ message: '取消失败', type: 'error' });
    }
  };

  // ── Item actions ────────────────────────────────────────────────────────
  const archiveItem = async (id: string) => {
    try {
      const res = await authFetch(`/api/knowledge/items/${id}/archive`, { method: 'POST' });
      if (!res.ok) throw new Error('归档失败');
      setToast({ message: '条目已归档', type: 'success' });
      fetchItems(undefined, itemFilters);
    } catch {
      setToast({ message: '归档失败', type: 'error' });
    }
  };

  const restoreItem = async (id: string) => {
    try {
      const res = await authFetch(`/api/knowledge/items/${id}/restore`, { method: 'POST' });
      if (!res.ok) throw new Error('恢复失败');
      setToast({ message: '条目已恢复', type: 'success' });
      fetchItems(undefined, itemFilters);
    } catch {
      setToast({ message: '恢复失败', type: 'error' });
    }
  };

  // Derive a revision draft from a published item, then jump into the review
  // page where the admin can edit / re-clean / approve it (approval overwrites
  // the existing item in place via the publisher's overwrite branch).
  const reviseItem = async (id: string) => {
    try {
      const res = await authFetch(`/api/knowledge/items/${id}/revise`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID(), 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? j?.message ?? '派生修订草稿失败');
      }
      const json = await res.json();
      setContentItemId(null);
      router.push(`/knowledge/review/${json.data.draftId}`);
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : '派生修订失败', type: 'error' });
    }
  };

  // ── Job columns ─────────────────────────────────────────────────────────
  const jobColumns = [
    {
      key: 'id',
      header: 'ID',
      render: (job: Job) => (
        <button
          type="button"
          onClick={() => {
            // Find draft id via job id — go to review page if pending_review
            if (job.status === 'pending_review') {
              router.push(`/knowledge/review/${job.id}`);
            }
          }}
          className="font-mono text-xs text-blue-600 hover:underline focus:outline-none"
        >
          {job.id.slice(0, 8)}…
        </button>
      ),
    },
    {
      key: 'sourceId',
      header: '来源 ID',
      render: (job: Job) => (
        <span className="font-mono text-xs text-gray-500">{job.sourceId.slice(0, 8)}…</span>
      ),
    },
    {
      key: 'status',
      header: '状态',
      render: (job: Job) => <JobStatusBadge status={job.status} />,
    },
    {
      key: 'attempt',
      header: '尝试次数',
      render: (job: Job) => (
        <span className="text-gray-600">
          {job.attempt}/{job.maxAttempts}
        </span>
      ),
    },
    {
      key: 'progress',
      header: '进度',
      render: (job: Job) => (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-blue-600 transition-all"
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
        <span className="max-w-[200px] truncate text-xs text-red-500" title={job.errorMessage ?? ''}>
          {job.errorMessage ?? '—'}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: '创建时间',
      render: (job: Job) => (
        <span className="text-xs text-gray-500">
          {new Date(job.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      render: (job: Job) => (
        <div className="flex gap-2">
          {job.status === 'failed' && (
            <button
              type="button"
              onClick={() =>
                setConfirmAction({
                  title: '重试任务',
                  message: `确定要重试任务 ${job.id.slice(0, 8)} 吗？`,
                  onConfirm: () => {
                    setConfirmAction(null);
                    retryJob(job.id);
                  },
                })
              }
              className="inline-flex min-h-[36px] min-w-[36px] items-center rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            >
              重试
            </button>
          )}
          {(job.status === 'queued') && (
            <button
              type="button"
              onClick={() =>
                setConfirmAction({
                  title: '取消任务',
                  message: `确定要取消任务 ${job.id.slice(0, 8)} 吗？`,
                  onConfirm: () => {
                    setConfirmAction(null);
                    cancelJob(job.id);
                  },
                })
              }
              className="inline-flex min-h-[36px] min-w-[36px] items-center rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500/40"
            >
              取消
            </button>
          )}
          {job.status === 'pending_review' && (
            <button
              type="button"
              onClick={() => router.push(`/knowledge/review/${job.id}`)}
              className="inline-flex min-h-[36px] min-w-[36px] items-center rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            >
              审核
            </button>
          )}
        </div>
      ),
    },
  ];

  // ── Source columns ───────────────────────────────────────────────────────
  const sourceColumns = [
    {
      key: 'originalName',
      header: '名称',
      render: (s: Source) => (
        <span className="font-medium text-gray-900">
          {s.inputType === 'file' ? s.originalName : s.sourceUrl}
        </span>
      ),
    },
    {
      key: 'inputType',
      header: '类型',
      render: (s: Source) => (
        <span className="text-gray-600">{s.inputType === 'file' ? '文件' : 'URL'}</span>
      ),
    },
    {
      key: 'status',
      header: '状态',
      render: (s: Source) => (
        <SourceStatusBadge status={s.status as Source['status']} />
      ),
    },
    {
      key: 'createdAt',
      header: '上传时间',
      render: (s: Source) => (
        <span className="text-xs text-gray-500">{new Date(s.createdAt).toLocaleString()}</span>
      ),
    },
  ];

  // ── Item filter config ──────────────────────────────────────────────────
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
        { value: 'published', label: '已发布' },
        { value: 'archived', label: '已归档' },
      ],
    },
  ];

  const draftFilterConfig = [
    {
      name: 'status',
      label: '状态',
      type: 'select' as const,
      options: DRAFT_STATUSES.map((s) => ({ value: s, label: s })),
    },
    {
      name: 'tier',
      label: '等级',
      type: 'select' as const,
      options: EVALUATION_TIERS.map((t) => ({ value: t, label: t })),
    },
  ];

  const draftColumns = [
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
      key: 'sourceName',
      header: '来源',
      render: (d: Draft) => (
        <span className="max-w-[200px] truncate text-xs text-gray-500" title={d.sourceName ?? ''}>
          {d.sourceName ?? '—'}
        </span>
      ),
    },
    {
      key: 'tier',
      header: '等级',
      render: (d: Draft) => (
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            TIER_BADGE[d.tier ?? ''] ?? TIER_BADGE.pending
          }`}
        >
          {d.tier ?? '—'}
        </span>
      ),
    },
    {
      key: 'overallScore',
      header: '总分',
      render: (d: Draft) => <span className="text-xs text-gray-600">{d.overallScore ?? '—'}</span>,
    },
    {
      key: 'reCleanCount',
      header: '重洗',
      render: (d: Draft) => (
        <span
          className={`text-xs ${d.reCleanCount > 0 ? 'font-medium text-amber-600' : 'text-gray-400'}`}
        >
          {d.reCleanCount > 0 ? `${d.reCleanCount} 次` : '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: '状态',
      render: (d: Draft) => <span className="text-xs text-gray-600">{d.status}</span>,
    },
    {
      key: 'createdAt',
      header: '创建时间',
      render: (d: Draft) => (
        <span className="text-xs text-gray-500">{new Date(d.createdAt).toLocaleString()}</span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      render: (d: Draft) => (
        <button
          type="button"
          onClick={() => router.push(`/knowledge/review/${d.id}`)}
          className="inline-flex min-h-[36px] min-w-[36px] items-center rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        >
          审核
        </button>
      ),
    },
  ];

  const TIER_BADGE: Record<string, string> = {
    A: 'bg-green-100 text-green-800',
    B: 'bg-blue-100 text-blue-800',
    C: 'bg-yellow-100 text-yellow-800',
    D: 'bg-red-100 text-red-800',
    pending: 'bg-gray-100 text-gray-600',
  };

  const evaluationFilterConfig = [
    {
      name: 'tier',
      label: '等级',
      type: 'select' as const,
      options: EVALUATION_TIERS.map((t) => ({ value: t, label: t })),
    },
    {
      name: 'status',
      label: '状态',
      type: 'select' as const,
      options: EVALUATION_STATUSES.map((s) => ({ value: s, label: s })),
    },
  ];

  const evaluationColumns = [
    {
      key: 'draftId',
      header: '草稿',
      render: (e: Evaluation) => (
        <button
          type="button"
          onClick={() => router.push(`/knowledge/review/${e.draftId}`)}
          className="font-mono text-xs text-blue-600 hover:underline focus:outline-none"
        >
          {e.draftId.slice(0, 8)}…
        </button>
      ),
    },
    {
      key: 'tier',
      header: '等级',
      render: (e: Evaluation) => (
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            TIER_BADGE[e.tier] ?? TIER_BADGE.pending
          }`}
        >
          {e.tier}
        </span>
      ),
    },
    {
      key: 'overallScore',
      header: '总分',
      render: (e: Evaluation) => (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-12 overflow-hidden rounded-full bg-gray-200">
            <div
              className={`h-full rounded-full ${
                e.overallScore >= 85 ? 'bg-green-500' : e.overallScore >= 60 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${e.overallScore}%` }}
            />
          </div>
          <span className="text-xs text-gray-600">{e.overallScore}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: '状态',
      render: (e: Evaluation) => <span className="text-xs text-gray-600">{e.status}</span>,
    },
    {
      key: 'deepEval',
      header: '深度',
      render: (e: Evaluation) => <span className="text-xs text-gray-500">{e.deepEval ? '是' : '否'}</span>,
    },
    {
      key: 'updatedAt',
      header: '更新时间',
      render: (e: Evaluation) => (
        <span className="text-xs text-gray-500">{new Date(e.updatedAt).toLocaleString()}</span>
      ),
    },
  ];

  // Shared table for the 评估 / 反馈 tabs (both list evaluations; clicking a
  // row opens the review page where feedback + re-clean happen).
  const renderEvaluationsTable = (emptyMessage: string) => (
    <div className="space-y-6">
      <FilterBar
        filters={evaluationFilterConfig}
        values={{ tier: evalTierFilter, status: evalStatusFilter }}
        onChange={(name, value) => {
          if (name === 'tier') {
            setEvalTierFilter(value);
            fetchEvaluations(undefined, value || undefined, evalStatusFilter || undefined);
          } else if (name === 'status') {
            setEvalStatusFilter(value);
            fetchEvaluations(undefined, evalTierFilter || undefined, value || undefined);
          }
        }}
      />
      <DataTable<Evaluation>
        columns={evaluationColumns}
        data={evaluations}
        loading={evaluationsLoading}
        emptyMessage={emptyMessage}
      />
      <Pagination
        nextCursor={evaluationsCursor}
        hasPrev={evaluationsCursorStack.length > 0}
        onPrev={() => {
          const stack = [...evaluationsCursorStack];
          stack.pop();
          const prev = stack[stack.length - 1] ?? undefined;
          setEvaluationsCursorStack(stack);
          fetchEvaluations(prev, evalTierFilter || undefined, evalStatusFilter || undefined);
        }}
        onNext={(cursor) => {
          setEvaluationsCursorStack([...evaluationsCursorStack, evaluationsCursor]);
          setEvaluationsCursor(cursor);
          fetchEvaluations(cursor, evalTierFilter || undefined, evalStatusFilter || undefined);
        }}
      />
    </div>
  );

  // ── Job filter config ───────────────────────────────────────────────────
  const jobFilterConfig = [
    {
      name: 'status',
      label: '状态',
      type: 'select' as const,
      options: JOB_STATUSES.map((s) => ({ value: s, label: s })),
    },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toast */}
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      {/* Confirm dialog */}
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

      {/* Page header */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">知识管理</h1>
          <p className="mt-1 text-sm text-gray-500">管理知识来源、处理任务和知识条目</p>
        </div>
        <CleaningBackendSwitch
          onSuccess={(m) => setToast({ message: m, type: 'success' })}
          onError={(m) => setToast({ message: m, type: 'error' })}
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 bg-white px-6">
        <Tabs
          tabs={[
            { id: 'overview', label: '概览' },
            { id: 'sources', label: '来源管理' },
            { id: 'jobs', label: '任务列表' },
            { id: 'drafts', label: '候选稿' },
            { id: 'items', label: '知识条目' },
            { id: 'evaluations', label: '评估' },
            { id: 'feedback', label: '反馈' },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
        />
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-6">
        {/* ── Overview tab ─────────────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {statsLoading && <p className="text-sm text-gray-500">加载中…</p>}
            {!statsLoading && stats && (
              <>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  <StatCard title="待审核草稿" value={stats.drafts.reviewQueue} subtitle="清洗完成待 review" />
                  <StatCard title="已发布条目" value={stats.items.total} subtitle="知识库总量" />
                  <StatCard
                    title="已归档"
                    value={stats.items.byStatus.find((s) => s.key === 'archived')?.count ?? 0}
                  />
                  <StatCard title="LLM 重洗累计" value={stats.reClean.jobsTotal} subtitle="按 job 计" />
                  <StatCard title="来源总数" value={stats.sources.total} />
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <DistributionPanel
                    title="已发布条目 · 分类分布"
                    buckets={stats.items.byCategory}
                    color="bg-blue-500"
                  />
                  <DistributionPanel
                    title="已发布条目 · 等级分布"
                    buckets={stats.tierDistribution}
                    color="bg-green-500"
                  />
                  <DistributionPanel
                    title="候选稿 · 状态分布"
                    buckets={stats.drafts.byStatus}
                    color="bg-amber-500"
                  />
                  <DistributionPanel
                    title="LLM 重洗 · 版本分布"
                    buckets={stats.reClean.byVersion.map((v) => ({ key: `v${v.version}`, count: v.count }))}
                    color="bg-purple-500"
                  />
                </div>
              </>
            )}
            {!statsLoading && !stats && <p className="text-sm text-gray-500">暂无统计数据</p>}
          </div>
        )}

        {/* ── Sources tab ─────────────────────────────────────────────── */}
        {activeTab === 'sources' && (
          <div className="space-y-6">
            <SourceUploadForm
              onSuccess={() => {
                setToast({ message: '来源已提交', type: 'success' });
                fetchSources();
              }}
              onError={(msg) => setToast({ message: msg, type: 'error' })}
            />

            <DataTable<Source>
              columns={sourceColumns}
              data={sources}
              loading={sourcesLoading}
              emptyMessage="暂无来源"
            />

            <Pagination
              nextCursor={sourcesCursor}
              hasPrev={sourcesCursorStack.length > 0}
              onPrev={() => {
                const stack = [...sourcesCursorStack];
                stack.pop();
                const prev = stack[stack.length - 1] ?? undefined;
                setSourcesCursorStack(stack);
                fetchSources(prev);
              }}
              onNext={(cursor) => {
                setSourcesCursorStack([...sourcesCursorStack, sourcesCursor]);
                setSourcesCursor(cursor);
                fetchSources(cursor);
              }}
            />
          </div>
        )}

        {/* ── Jobs tab ────────────────────────────────────────────────── */}
        {activeTab === 'jobs' && (
          <div className="space-y-6">
            <FilterBar
              filters={jobFilterConfig}
              values={{ status: jobStatusFilter }}
              onChange={(name, value) => {
                if (name === 'status') {
                  setJobStatusFilter(value);
                  fetchJobs(undefined, value || undefined);
                }
              }}
            />

            <DataTable<Job>
              columns={jobColumns}
              data={jobs}
              loading={jobsLoading}
              emptyMessage="暂无任务"
            />

            <Pagination
              nextCursor={jobsCursor}
              hasPrev={jobsCursorStack.length > 0}
              onPrev={() => {
                const stack = [...jobsCursorStack];
                stack.pop();
                const prev = stack[stack.length - 1] ?? undefined;
                setJobsCursorStack(stack);
                fetchJobs(prev, jobStatusFilter || undefined);
              }}
              onNext={(cursor) => {
                setJobsCursorStack([...jobsCursorStack, jobsCursor]);
                setJobsCursor(cursor);
                fetchJobs(cursor, jobStatusFilter || undefined);
              }}
            />
          </div>
        )}

        {/* ── Drafts tab ─────────────────────────────────────────────────── */}
        {activeTab === 'drafts' && (
          <div className="space-y-6">
            <FilterBar
              filters={draftFilterConfig}
              values={draftFilters}
              onChange={(name, value) => {
                const newFilters = { ...draftFilters, [name]: value };
                setDraftFilters(newFilters);
              }}
              onSearch={() => {
                setDraftsCursorStack([]);
                fetchDrafts(undefined, draftFilters);
              }}
            />

            <DataTable<Draft>
              columns={draftColumns}
              data={drafts}
              loading={draftsLoading}
              emptyMessage="暂无候选稿"
            />

            <Pagination
              nextCursor={draftsCursor}
              hasPrev={draftsCursorStack.length > 0}
              onPrev={() => {
                const stack = [...draftsCursorStack];
                stack.pop();
                const prev = stack[stack.length - 1] ?? undefined;
                setDraftsCursorStack(stack);
                fetchDrafts(prev, draftFilters);
              }}
              onNext={(cursor) => {
                setDraftsCursorStack([...draftsCursorStack, draftsCursor]);
                setDraftsCursor(cursor);
                fetchDrafts(cursor, draftFilters);
              }}
            />
          </div>
        )}

        {/* ── Items tab ───────────────────────────────────────────────── */}
        {activeTab === 'items' && (
          <div className="space-y-6">
            <FilterBar
              filters={itemFilterConfig}
              values={itemFilters}
              onChange={(name, value) => {
                const newFilters = { ...itemFilters, [name]: value };
                setItemFilters(newFilters);
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
              onRevise={reviseItem}
              onArchive={(id) =>
                setConfirmAction({
                  title: '归档条目',
                  message: '确定要归档该知识条目吗？',
                  onConfirm: () => {
                    setConfirmAction(null);
                    archiveItem(id);
                  },
                })
              }
              onRestore={(id) =>
                setConfirmAction({
                  title: '恢复条目',
                  message: '确定要恢复该知识条目吗？',
                  onConfirm: () => {
                    setConfirmAction(null);
                    restoreItem(id);
                  },
                })
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

        {/* ── Evaluations tab ─────────────────────────────────────────────── */}
        {activeTab === 'evaluations' && renderEvaluationsTable('暂无评估')}

        {/* ── Feedback tab ────────────────────────────────────────────────── */}
        {activeTab === 'feedback' && renderEvaluationsTable('暂无待反馈草稿')}
      </div>
    </div>
  );
}

// Lightweight horizontal-bar distribution panel for the 概览 dashboard. Each
// row is a bucket (key + count); bar width is relative to the max bucket so
// small values stay visible. No chart dependency — pure Tailwind bars.
function DistributionPanel({
  title,
  buckets,
  color,
}: {
  title: string;
  buckets: { key: string; count: number }[];
  color: string;
}) {
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {buckets.length === 0 ? (
        <p className="mt-3 text-xs text-gray-400">暂无数据</p>
      ) : (
        <div className="mt-3 space-y-2">
          {buckets.map((b) => (
            <div key={b.key} className="flex items-center gap-3">
              <span className="w-24 shrink-0 truncate text-xs text-gray-600" title={b.key}>
                {b.key}
              </span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-gray-100">
                <div
                  className={`h-full rounded ${color}`}
                  style={{ width: `${(b.count / max) * 100}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right text-xs font-medium text-gray-700">
                {b.count}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-gray-400">合计 {total}</p>
    </div>
  );
}
