'use client';

import { useEffect } from 'react';

interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info';
  onClose: () => void;
}

const typeClasses: Record<ToastProps['type'], string> = {
  success: 'bg-green-600',
  error: 'bg-red-600',
  info: 'bg-blue-600',
};

export function Toast({ message, type, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed inset-x-0 top-4 z-50 flex justify-center pointer-events-none">
      <div
        role="alert"
        className={`pointer-events-auto flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${typeClasses[type]}`}
      >
        <span>{message}</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-1 flex min-h-[28px] min-w-[28px] items-center justify-center rounded text-white/80 hover:text-white focus:outline-none"
          aria-label="关闭通知"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
