'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { setAccessToken, authFetch } from '@/lib/auth-client';
import { AdminNav } from '@/components/admin/AdminNav';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await authFetch('/api/auth/me');
        if (res.ok) {
          const json = (await res.json()) as {
            data: { accessToken?: string; user: { role: string } };
          };
          if (json.data.accessToken) {
            setAccessToken(json.data.accessToken);
          }
          if (json.data.user.role !== 'admin') {
            router.replace('/chat');
            return;
          }
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
          <p className="text-sm text-gray-600">正在验证管理员权限…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <AdminNav />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
