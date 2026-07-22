'use client';

interface PaginationProps {
  nextCursor: string | null;
  onPrev?: () => void;
  onNext: (cursor: string) => void;
  hasPrev?: boolean;
}

export function Pagination({ nextCursor, onPrev, onNext, hasPrev = false }: PaginationProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <button
        type="button"
        onClick={onPrev}
        disabled={!hasPrev || !onPrev}
        className="inline-flex min-h-[44px] min-w-[44px] items-center gap-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="上一页"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        上一页
      </button>

      <button
        type="button"
        onClick={() => {
          if (nextCursor) onNext(nextCursor);
        }}
        disabled={!nextCursor}
        className="inline-flex min-h-[44px] min-w-[44px] items-center gap-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="下一页"
      >
        下一页
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
