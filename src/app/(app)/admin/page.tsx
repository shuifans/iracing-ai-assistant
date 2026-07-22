'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FullScreenLoader } from '@/components/common';

/**
 * /admin index — no dashboard landing page; redirect to the first sub-route.
 * Client-side redirect because server-side redirect() is unreliable under
 * nested client component layouts (AuthGate gates children rendering).
 */
export default function AdminIndexPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/users');
  }, [router]);
  return <FullScreenLoader label="正在跳转…" />;
}
