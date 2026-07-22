'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { authFetch } from '@/lib/auth-client';
import { SessionSidebar } from '@/components/chat/SessionSidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    async function checkAuth() {
      try {
        // Login stores the short-lived access token in the shared in-memory
        // auth client. authFetch uses it first and falls back to the HttpOnly
        // refresh cookie after a full page reload.
        const res = await authFetch('/api/auth/me');
        if (res.ok) {
          const json = (await res.json()) as { data?: { user?: { role?: string } } };
          setRole(json.data?.user?.role ?? null);
          setAuthChecked(true);
        } else {
          router.replace('/login');
        }
      } catch {
        router.replace('/login');
      }
    }
    checkAuth();
  }, [router]);

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          <p className="text-sm text-gray-600">正在验证登录状态…</p>
        </div>
      </div>
    );
  }

  const isKnowledgeAdmin = role === 'admin' || role === 'knowledge_admin';
  const adminLinks = (
    <>
      <Link
        href="/knowledge"
        className={`transition-colors hover:text-gray-700 ${
          pathname.startsWith('/knowledge') ? 'text-gray-700' : 'text-gray-400'
        }`}
      >
        知识管理
      </Link>
      {role === 'admin' && (
        <Link href="/admin" className="text-gray-400 transition-colors hover:text-gray-700">
          账户管理
        </Link>
      )}
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* 侧边栏 */}
      <SessionSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* 主内容区 */}
      <main className="relative flex flex-1 flex-col overflow-hidden">
        {/* 移动端顶部导航栏 */}
        <header className="flex items-center border-b border-gray-200 bg-white px-3 py-2 md:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
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
          <h1 className="ml-3 text-base font-semibold text-gray-900">iRacing AI 助手</h1>
          {isKnowledgeAdmin && (
            <nav className="ml-auto flex items-center gap-3 text-xs" aria-label="管理入口">
              {adminLinks}
            </nav>
          )}
        </header>

        {/* 桌面端右上角管理入口（小字） */}
        {isKnowledgeAdmin && (
          <nav
            className="absolute right-4 top-2 z-40 hidden items-center gap-3 text-xs md:flex"
            aria-label="管理入口"
          >
            {adminLinks}
          </nav>
        )}

        {/* 页面内容 */}
        <div className="flex-1 overflow-hidden">{children}</div>
      </main>
    </div>
  );
}
