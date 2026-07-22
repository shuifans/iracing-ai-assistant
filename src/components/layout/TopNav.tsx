'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { useShell } from '@/components/providers/ShellProvider';
import { LogoMark } from './Logo';
import { MobileDrawer } from './MobileDrawer';
import { UserMenu } from './UserMenu';
import { modulesForRole } from './modules';

export function TopNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { sidebarOpen, setSidebarOpen } = useShell();
  const modules = modulesForRole(user?.role);

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white">
      <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
        {/* 移动端汉堡 */}
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500/40 md:hidden"
          aria-label="打开菜单"
        >
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>

        {/* Logo */}
        <Link href="/chat" className="flex items-center gap-2 focus:outline-none">
          <LogoMark />
          <span className="hidden text-base font-bold tracking-tight text-navy-900 min-[400px]:block">
            iRacing AI 助手
          </span>
        </Link>

        {/* 桌面端模块链接 */}
        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="模块导航">
          {modules.map((m) => {
            const isActive = pathname.startsWith(m.href);
            return (
              <Link
                key={m.href}
                href={m.href}
                className={`relative flex h-14 items-center px-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500/40 ${
                  isActive ? 'font-semibold text-navy-900' : 'text-gray-500 hover:text-navy-900'
                }`}
              >
                {m.label}
                {isActive && (
                  <span className="absolute inset-x-3 bottom-1.5 h-[3px] rounded-full bg-accent-400" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* 用户菜单 */}
        <div className="ml-auto">
          <UserMenu />
        </div>
      </div>

      <MobileDrawer isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
    </header>
  );
}
