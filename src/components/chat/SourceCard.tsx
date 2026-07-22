'use client';

import type { MessageSourceData } from '@/modules/chat/types';

interface SourceCardProps {
  source: MessageSourceData;
}

export function SourceCard({ source }: SourceCardProps) {
  const isWeb = source.sourceType === 'web';
  const href = source.url ?? undefined;
  const typeLabel = isWeb ? '网页' : 'Wiki';
  const typeIcon = isWeb ? '🌐' : '📖';

  const handleClick = () => {
    if (href) {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!href}
      className="flex min-h-[44px] w-full items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-default disabled:hover:bg-gray-50"
      aria-label={`来源: ${source.title}`}
    >
      <span className="flex-shrink-0 text-base leading-5" aria-hidden>
        {typeIcon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium text-gray-800">{source.title}</span>
        <span className="text-gray-500">
          [{source.ordinal}] {typeLabel}
          {source.season && ` · ${source.season}`}
        </span>
      </span>
    </button>
  );
}
