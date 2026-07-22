'use client';

import { useState, useEffect, startTransition } from 'react';
import { authFetch } from '@/lib/auth-client';

interface ItemRecord {
  id: string;
  title: string;
  category: string;
  subcategory: string;
  status: string;
  wikiPath: string;
  season: string;
  [key: string]: unknown;
}

interface ItemContent {
  item: ItemRecord;
  renderedMarkdown: string;
  body: string;
  frontMatter: { title: string; tags?: string[]; season?: string } | null;
}

interface ItemContentModalProps {
  itemId: string | null;
  onClose: () => void;
  onRevise?: (itemId: string) => void;
}

// Modal that fetches + renders a published knowledge item's body. Mirrors the
// ConfirmDialog overlay style. The "派生修订" action is shown only for items
// still in 'published' status (archived items must be restored first).
export function ItemContentModal({ itemId, onClose, onRevise }: ItemContentModalProps) {
  const [data, setData] = useState<ItemContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!itemId) return;
    let cancelled = false;
    // Wrapped in startTransition to avoid cascading renders (matches the
    // knowledge page hook's fetch-on-tab pattern).
    startTransition(() => {
      setLoading(true);
      setError(null);
      setData(null);
    });
    authFetch(`/api/knowledge/items/${itemId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('加载正文失败');
        const json = await res.json();
        if (!cancelled) setData(json.data as ItemContent);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (!itemId) return null;

  const item = data?.item;
  const canRevise = onRevise && item?.status === 'published';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex max-h-[85vh] w-full max-w-3xl flex-col rounded-card bg-white shadow-pop"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-gray-900">
              {item?.title ?? '加载中…'}
            </h3>
            {item && (
              <p className="mt-1 truncate text-xs text-gray-500">
                {item.category} / {item.subcategory} · {item.season} · {item.wikiPath}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            {canRevise && (
              <button
                type="button"
                onClick={() => onRevise!(itemId)}
                className="inline-flex min-h-[36px] items-center rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
              >
                派生修订
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-[36px] items-center rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            >
              关闭
            </button>
          </div>
        </div>

        <div className="overflow-auto px-6 py-4">
          {loading && <p className="text-sm text-gray-500">加载中…</p>}
          {error && <p className="text-sm text-red-500">{error}</p>}
          {data && (
            <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-gray-700">
              {data.body || data.renderedMarkdown || '（无正文）'}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
