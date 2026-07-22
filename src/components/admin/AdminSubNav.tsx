'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/admin/users', label: '用户管理' },
  { href: '/admin/sessions', label: '会话质检' },
  { href: '/admin/stats', label: '统计面板' },
  { href: '/admin/settings', label: '限流/设置' },
  { href: '/admin/audit', label: '审计日志' },
] as const;

export function AdminSubNav() {
  const pathname = usePathname();

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + '/');
  }

  return (
    <div className="border-b border-gray-200 bg-white">
      <nav
        className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4"
        aria-label="账户管理子导航"
      >
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`-mb-px inline-flex min-h-[44px] flex-shrink-0 items-center border-b-2 px-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500/40 ${
              isActive(item.href)
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-navy-900'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
