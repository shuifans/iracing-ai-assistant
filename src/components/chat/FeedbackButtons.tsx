'use client';

import { useState, useCallback } from 'react';
import { authFetch } from '@/lib/auth-client';

interface FeedbackButtonsProps {
  messageId: string;
  initialRating?: 'up' | 'down' | null;
}

export function FeedbackButtons({ messageId, initialRating }: FeedbackButtonsProps) {
  const [rating, setRating] = useState<'up' | 'down' | null>(initialRating ?? null);
  const [submitting, setSubmitting] = useState(false);

  const handleFeedback = useCallback(
    async (newRating: 'up' | 'down') => {
      if (submitting) return;
      setSubmitting(true);

      try {
        if (rating === newRating) {
          // 取消评价
          const res = await authFetch(`/api/chat/messages/${messageId}/feedback`, {
            method: 'DELETE',
          });
          if (res.ok) {
            setRating(null);
          }
        } else {
          // 新增或更新评价
          const res = await authFetch(`/api/chat/messages/${messageId}/feedback`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rating: newRating }),
          });
          if (res.ok) {
            setRating(newRating);
          }
        }
      } catch {
        // 静默失败
      } finally {
        setSubmitting(false);
      }
    },
    [messageId, rating, submitting],
  );

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => handleFeedback('up')}
        disabled={submitting}
        aria-label="点赞"
        aria-pressed={rating === 'up'}
        className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-lg transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-50 ${
          rating === 'up'
            ? 'bg-brand-100 text-brand-600'
            : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
        }`}
      >
        👍
      </button>
      <button
        type="button"
        onClick={() => handleFeedback('down')}
        disabled={submitting}
        aria-label="点踩"
        aria-pressed={rating === 'down'}
        className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-lg transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-50 ${
          rating === 'down'
            ? 'bg-red-100 text-red-600'
            : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
        }`}
      >
        👎
      </button>
    </div>
  );
}
