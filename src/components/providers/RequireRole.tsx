'use client';

import { FullScreenLoader } from '@/components/common';
import { useRequireRole } from './AuthProvider';

interface RequireRoleProps {
  roles: readonly string[];
  label?: string;
  children: React.ReactNode;
}

export function RequireRole({ roles, label = '正在验证权限…', children }: RequireRoleProps) {
  const user = useRequireRole(roles);
  if (!user) {
    return <FullScreenLoader label={label} />;
  }
  return <>{children}</>;
}
