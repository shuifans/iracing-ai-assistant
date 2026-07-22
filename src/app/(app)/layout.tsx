'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AuthProvider, useAuth } from '@/components/providers/AuthProvider';
import { ShellProvider } from '@/components/providers/ShellProvider';
import { TopNav } from '@/components/layout/TopNav';
import { FullScreenLoader } from '@/components/common';

function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { status } = useAuth();

  useEffect(() => {
    if (status === 'unauthed') {
      router.replace('/login');
    }
  }, [status, router]);

  if (status !== 'authed') {
    return <FullScreenLoader label="正在验证登录状态…" />;
  }
  return <>{children}</>;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AuthGate>
        <ShellProvider>
          <div className="flex min-h-dvh flex-col">
            <TopNav />
            <div className="flex flex-1 flex-col">{children}</div>
          </div>
        </ShellProvider>
      </AuthGate>
    </AuthProvider>
  );
}
