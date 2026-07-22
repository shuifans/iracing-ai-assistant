'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { SessionListContent } from '@/components/chat/SessionListContent';
import { LogoMark } from './Logo';
import { modulesForRole } from './modules';

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MobileDrawer({ isOpen, onClose }: MobileDrawerProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const modules = modulesForRole(user?.role);
  const inChat = pathname.startsWith('/chat');

  // 关闭时不渲染：避免抽屉内的会话列表在后台挂载并发起重复请求
  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={onClose} aria-hidden />

      <div
        className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-white shadow-pop md:hidden"
        role="dialog"
        aria-label="移动端导航"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
          <div className="flex items-center gap-2">
            <LogoMark className="h-6 w-6" />
            <span className="text-sm font-bold text-navy-900">iRacing AI 助手</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            aria-label="关闭菜单"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* 模块链接 */}
        <nav className="border-b border-gray-200 px-3 py-2" aria-label="移动端模块导航">
          {modules.map((m) => {
            const isActive = pathname.startsWith(m.href);
            return (
              <Link
                key={m.href}
                href={m.href}
                onClick={onClose}
                className={`flex min-h-[44px] items-center rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-brand-50 font-semibold text-brand-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-navy-900'
                }`}
              >
                {m.label}
              </Link>
            );
          })}
        </nav>

        {/* 会话列表（仅对话模块） */}
        {inChat && (
          <div className="flex min-h-0 flex-1 flex-col">
            <SessionListContent onNavigate={onClose} />
          </div>
        )}
      </div>
    </>
  );
}
