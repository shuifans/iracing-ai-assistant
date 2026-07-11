'use client';

import { Badge } from '@/components/common';
import type { JobStatus } from '@/config/constants';
import type { KnowledgeSourceStatus, KnowledgeItemStatus, WikiSyncStatus } from '@/config/constants';

type JobBadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

const jobStatusVariant: Record<JobStatus, JobBadgeVariant> = {
  queued: 'default',
  extracting: 'info',
  cleaning: 'info',
  pending_review: 'warning',
  publishing: 'info',
  published: 'success',
  rejected: 'danger',
  failed: 'danger',
  cancelled: 'default',
};

const jobStatusLabels: Record<JobStatus, string> = {
  queued: '排队中',
  extracting: '提取中',
  cleaning: '清洗中',
  pending_review: '待审核',
  publishing: '发布中',
  published: '已发布',
  rejected: '已拒绝',
  failed: '失败',
  cancelled: '已取消',
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <Badge label={jobStatusLabels[status]} variant={jobStatusVariant[status]} />;
}

const sourceStatusVariant: Record<KnowledgeSourceStatus, JobBadgeVariant> = {
  stored: 'default',
  queued: 'info',
  processing: 'info',
  ready: 'success',
  failed: 'danger',
  archived: 'default',
};

const sourceStatusLabels: Record<KnowledgeSourceStatus, string> = {
  stored: '已存储',
  queued: '排队中',
  processing: '处理中',
  ready: '就绪',
  failed: '失败',
  archived: '已归档',
};

export function SourceStatusBadge({ status }: { status: KnowledgeSourceStatus }) {
  return <Badge label={sourceStatusLabels[status]} variant={sourceStatusVariant[status]} />;
}

const itemStatusVariant: Record<KnowledgeItemStatus, JobBadgeVariant> = {
  published: 'success',
  archived: 'default',
};

const itemStatusLabels: Record<KnowledgeItemStatus, string> = {
  published: '已发布',
  archived: '已归档',
};

export function ItemStatusBadge({ status }: { status: KnowledgeItemStatus }) {
  return <Badge label={itemStatusLabels[status]} variant={itemStatusVariant[status]} />;
}

const syncStatusVariant: Record<WikiSyncStatus, JobBadgeVariant> = {
  committed: 'info',
  push_pending: 'warning',
  synced: 'success',
  push_failed: 'danger',
};

const syncStatusLabels: Record<WikiSyncStatus, string> = {
  committed: '已提交',
  push_pending: '待推送',
  synced: '已同步',
  push_failed: '推送失败',
};

export function SyncStatusBadge({ status }: { status: WikiSyncStatus }) {
  return <Badge label={syncStatusLabels[status]} variant={syncStatusVariant[status]} />;
}
