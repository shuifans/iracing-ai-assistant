'use client';

import { useState } from 'react';
import { authFetch } from '@/lib/auth-client';
import { Badge } from '@/components/common';

interface FrontMatter {
  title: string;
  category: string;
  subcategory: string;
  tags: string[];
  source_name?: string;
  source_url?: string;
  season?: string;
  updated_at?: string;
}

interface DraftData {
  id: string;
  title: string;
  status: string;
  suggestedPath: string;
  frontMatterJson: string;
  draftRelativePath: string;
  reviewNotes?: string | null;
  createdAt: string;
}

interface SourceData {
  id: string;
  inputType: string;
  originalName?: string | null;
  sourceUrl?: string | null;
}

interface DraftReviewerProps {
  draft: DraftData;
  source: SourceData;
  extractedText: string | null;
  renderedMarkdown: string;
  onSuccess?: () => void;
  onError?: (message: string) => void;
}

export function DraftReviewer({
  draft,
  source,
  extractedText,
  renderedMarkdown,
  onSuccess,
  onError,
}: DraftReviewerProps) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(renderedMarkdown);
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  let frontMatter: FrontMatter | null = null;
  try {
    frontMatter = JSON.parse(draft.frontMatterJson) as FrontMatter;
  } catch {
    // ignore parse error
  }

  const handleSaveEdit = async () => {
    setSubmitting(true);
    try {
      const res = await authFetch(`/api/knowledge/drafts/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message?: string } };
        throw new Error(json.error?.message ?? '保存失败');
      }
      setEditing(false);
      onSuccess?.();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async () => {
    setSubmitting(true);
    try {
      const idempotencyKey = crypto.randomUUID();
      const res = await authFetch(`/api/knowledge/drafts/${draft.id}/approve`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message?: string } };
        throw new Error(json.error?.message ?? '批准失败');
      }
      onSuccess?.();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : '批准失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    setSubmitting(true);
    try {
      const res = await authFetch(`/api/knowledge/drafts/${draft.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message?: string } };
        throw new Error(json.error?.message ?? '拒绝失败');
      }
      setShowReject(false);
      setRejectReason('');
      onSuccess?.();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : '拒绝失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{draft.title}</h2>
            <p className="mt-1 text-sm text-gray-500">路径: {draft.suggestedPath}</p>
            <p className="mt-1 text-sm text-gray-500">
              来源: {source.inputType === 'file' ? source.originalName : source.sourceUrl}
            </p>
          </div>
          <Badge label={draft.status} variant="warning" />
        </div>

        {/* Front Matter */}
        {frontMatter && (
          <div className="mt-4 rounded-lg bg-gray-50 p-4">
            <h3 className="mb-2 text-sm font-semibold text-gray-700">Front Matter</h3>
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <span className="font-medium text-gray-600">标题: </span>
                <span className="text-gray-800">{frontMatter.title}</span>
              </div>
              <div>
                <span className="font-medium text-gray-600">分类: </span>
                <span className="text-gray-800">{frontMatter.category}</span>
              </div>
              <div>
                <span className="font-medium text-gray-600">子分类: </span>
                <span className="text-gray-800">{frontMatter.subcategory}</span>
              </div>
              {frontMatter.season && (
                <div>
                  <span className="font-medium text-gray-600">赛季: </span>
                  <span className="text-gray-800">{frontMatter.season}</span>
                </div>
              )}
              <div className="sm:col-span-2 lg:col-span-4">
                <span className="font-medium text-gray-600">标签: </span>
                <span className="text-gray-800">{frontMatter.tags.join(', ')}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Diff view: extracted (left) + rendered (right) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Extracted text */}
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-700">原文（提取内容）</h3>
          </div>
          <div className="max-h-[600px] overflow-auto p-4">
            <pre className="whitespace-pre-wrap text-sm text-gray-700">
              {extractedText ?? '无提取文本'}
            </pre>
          </div>
        </div>

        {/* Candidate draft */}
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-700">候选稿</h3>
            {!editing && draft.status === 'pending_review' && (
              <button
                type="button"
                onClick={() => {
                  setContent(renderedMarkdown);
                  setEditing(true);
                }}
                className="inline-flex min-h-[36px] min-w-[36px] items-center rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              >
                编辑
              </button>
            )}
          </div>
          <div className="max-h-[600px] overflow-auto p-4">
            {editing ? (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={25}
                className="w-full resize-none rounded-lg border border-gray-300 bg-white p-3 font-mono text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            ) : (
              <pre className="whitespace-pre-wrap text-sm text-gray-700">{renderedMarkdown}</pre>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      {draft.status === 'pending_review' && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
          {editing ? (
            <>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={submitting}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50"
              >
                {submitting ? '保存中…' : '保存修改'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              >
                取消
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleApprove}
                disabled={submitting}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-green-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500/40 disabled:opacity-50"
              >
                {submitting ? '处理中…' : '通过审查'}
              </button>
              <button
                type="button"
                onClick={() => setShowReject(true)}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-red-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/40"
              >
                拒绝
              </button>
            </>
          )}

          {showReject && !editing && (
            <div className="flex w-full flex-col gap-3 border-t border-gray-200 pt-4 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label
                  htmlFor="reject-reason"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  拒绝理由
                </label>
                <textarea
                  id="reject-reason"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={2}
                  placeholder="请输入拒绝理由…"
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={!rejectReason.trim() || submitting}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/40 disabled:opacity-50"
                >
                  {submitting ? '提交中…' : '确认拒绝'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowReject(false);
                    setRejectReason('');
                  }}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {draft.reviewNotes && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4">
          <h4 className="text-sm font-semibold text-yellow-800">审核备注</h4>
          <p className="mt-1 text-sm text-yellow-700">{draft.reviewNotes}</p>
        </div>
      )}
    </div>
  );
}
