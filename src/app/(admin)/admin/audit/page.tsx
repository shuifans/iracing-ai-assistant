'use client';

import { useState, useEffect, useCallback, startTransition } from 'react';
import { authFetch } from '@/lib/auth-client';
import { FilterBar } from '@/components/common/FilterBar';
import { Pagination } from '@/components/common/Pagination';
import { AuditLogTable } from '@/components/admin/AuditLogTable';
import { AUDIT_ACTIONS } from '@/modules/audit/types';
import type { AuditLogEntry } from '@/modules/audit/types';

const ACTION_OPTIONS = AUDIT_ACTIONS.map((a) => ({ value: a, label: a }));

const RESOURCE_OPTIONS = [
  { value: 'user', label: 'user' },
  { value: 'session', label: 'session' },
  { value: 'knowledge_source', label: 'knowledge_source' },
  { value: 'knowledge_job', label: 'knowledge_job' },
  { value: 'knowledge_draft', label: 'knowledge_draft' },
  { value: 'knowledge_item', label: 'knowledge_item' },
  { value: 'rate_limit_config', label: 'rate_limit_config' },
  { value: 'system_setting', label: 'system_setting' },
];

const FILTERS = [
  { name: 'actorId', label: '操作者 ID', type: 'text' as const },
  { name: 'action', label: '动作类型', type: 'select' as const, options: ACTION_OPTIONS },
  { name: 'resource', label: '资源类型', type: 'select' as const, options: RESOURCE_OPTIONS },
  { name: 'fromDate', label: '开始日期', type: 'date' as const },
  { name: 'toDate', label: '结束日期', type: 'date' as const },
];

interface ApiResult {
  data: { auditLogs: AuditLogEntry[] };
  meta: { nextCursor: string | null };
}

function useAuditLogs() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [currentCursor, setCurrentCursor] = useState<string | undefined>(undefined);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});

  const fetchLogs = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      const params = new URLSearchParams();
      if (filterValues.actorId) params.set('actorId', filterValues.actorId);
      if (filterValues.action) params.set('action', filterValues.action);
      if (filterValues.resource) params.set('resource', filterValues.resource);
      if (filterValues.fromDate) params.set('fromDate', filterValues.fromDate);
      if (filterValues.toDate) params.set('toDate', filterValues.toDate);
      if (cursor) params.set('cursor', cursor);

      try {
        const res = await authFetch(`/api/admin/audit-logs?${params.toString()}`);
        if (res.ok) {
          const json: ApiResult = await res.json();
          setLogs(json.data.auditLogs);
          setNextCursor(json.meta.nextCursor);
        }
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    },
    [filterValues],
  );

  useEffect(() => {
    startTransition(() => {
      fetchLogs(currentCursor);
    });
  }, [fetchLogs, currentCursor]);

  function handleFilterChange(name: string, value: string) {
    setFilterValues((prev) => ({ ...prev, [name]: value }));
    setCursorStack([]);
    setCurrentCursor(undefined);
  }

  function handleNext(cursor: string) {
    setCursorStack((prev) => [...prev, currentCursor ?? '']);
    setCurrentCursor(cursor);
  }

  function handlePrev() {
    setCursorStack((prev) => {
      const next = [...prev];
      const last = next.pop();
      setCurrentCursor(last === '' ? undefined : last);
      return next;
    });
  }

  return { logs, loading, nextCursor, cursorStack, filterValues, handleFilterChange, handleNext, handlePrev };
}

export default function AuditPage() {
  const { logs, loading, nextCursor, cursorStack, filterValues, handleFilterChange, handleNext, handlePrev } = useAuditLogs();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">审计日志</h1>

      <FilterBar
        filters={FILTERS}
        values={filterValues}
        onChange={handleFilterChange}
      />

      <AuditLogTable data={logs} loading={loading} />

      <Pagination
        nextCursor={nextCursor}
        hasPrev={cursorStack.length > 0}
        onPrev={handlePrev}
        onNext={handleNext}
      />
    </div>
  );
}
