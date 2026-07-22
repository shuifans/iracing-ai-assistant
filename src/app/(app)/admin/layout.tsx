'use client';

import { RequireRole } from '@/components/providers/RequireRole';
import { AdminSubNav } from '@/components/admin/AdminSubNav';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole roles={['admin']} label="正在验证管理员权限…">
      <AdminSubNav />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
    </RequireRole>
  );
}
