'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/common';
import { useAuth } from '@/components/providers/AuthProvider';
import { ROLE_LABELS } from './modules';

const ROLE_BADGE_VARIANTS: Record<string, 'info' | 'warning' | 'default'> = {
  admin: 'info',
  knowledge_admin: 'warning',
  user: 'default',
};

export function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!user) return null;

  const initial = user.username.charAt(0).toUpperCase();

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[44px] items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="用户菜单"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
          {initial}
        </span>
        <span className="hidden max-w-[120px] truncate text-sm font-medium text-navy-900 sm:block">
          {user.username}
        </span>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-56 rounded-card border border-gray-200 bg-white p-2 shadow-pop"
          >
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="truncate text-sm font-medium text-navy-900">{user.username}</span>
              <Badge
                label={ROLE_LABELS[user.role] ?? user.role}
                variant={ROLE_BADGE_VARIANTS[user.role] ?? 'default'}
              />
            </div>
            <hr className="my-1 border-gray-100" />
            <button
              type="button"
              onClick={() => void logout()}
              className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
              退出登录
            </button>
          </div>
        </>
      )}
    </div>
  );
}
