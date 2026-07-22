'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { authFetch } from '@/lib/auth-client';

const NAV_ITEMS = [
  { href: '/admin/users', label: '用户管理' },
  { href: '/admin/sessions', label: '会话质检' },
  { href: '/admin/stats', label: '统计面板' },
  { href: '/admin/settings', label: '限流/设置' },
  { href: '/admin/audit', label: '审计日志' },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  async function handleLogout() {
    try {
      await authFetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // 静默
    }
    window.location.href = '/login';
  }

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + '/');
  }

  return (
    <header className="relative z-30 bg-gray-900 text-white shadow-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        {/* 左侧: 品牌 + 桌面导航 */}
        <div className="flex items-center gap-1">
          <span className="mr-3 text-base font-semibold whitespace-nowrap">Admin</span>

          {/* 桌面导航链接 */}
          <nav className="hidden items-center gap-1 md:flex" aria-label="Admin 导航">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                  isActive(item.href)
                    ? 'bg-gray-700 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* 右侧: 知识管理 + 返回聊天 + 退出 (桌面) */}
        <div className="hidden items-center gap-2 md:flex">
          <Link
            href="/knowledge"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            知识管理
          </Link>
          <Link
            href="/chat"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            返回聊天
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
            退出
          </button>
        </div>

        {/* 移动端: 汉堡按钮 */}
        <button
          type="button"
          onClick={() => setMobileMenuOpen((v) => !v)}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-gray-300 hover:bg-gray-800 hover:text-white md:hidden"
          aria-label="打开导航菜单"
        >
          {mobileMenuOpen ? (
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          ) : (
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          )}
        </button>
      </div>

      {/* 移动端下拉菜单 */}
      {mobileMenuOpen && (
        <div className="border-t border-gray-700 md:hidden">
          <nav className="mx-auto max-w-7xl space-y-1 px-4 py-3" aria-label="移动端导航">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive(item.href)
                    ? 'bg-gray-700 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                {item.label}
              </Link>
            ))}
            <hr className="border-gray-700" />
            <Link
              href="/knowledge"
              onClick={() => setMobileMenuOpen(false)}
              className="block rounded-md px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
            >
              知识管理
            </Link>
            <Link
              href="/chat"
              onClick={() => setMobileMenuOpen(false)}
              className="block rounded-md px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
            >
              返回聊天
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
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
          </nav>
        </div>
      )}
    </header>
  );
}
