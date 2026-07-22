'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth-client';

export interface AuthUser {
  id: string;
  username: string;
  role: string;
  status: string;
}

type AuthStatus = 'loading' | 'authed' | 'unauthed';

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await Promise.race([
          authFetch('/api/auth/me'),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('auth timeout')), 15_000),
          ),
        ]);
        if (cancelled) return;
        if (res.ok) {
          const json = (await res.json()) as { data?: { user?: AuthUser } };
          if (json.data?.user) {
            setUser(json.data.user);
            setStatus('authed');
            return;
          }
        }
        setStatus('unauthed');
      } catch {
        if (!cancelled) setStatus('unauthed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await authFetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // 静默
    }
    window.location.href = '/login';
  }, []);

  return <AuthContext.Provider value={{ user, status, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth 必须在 AuthProvider 内使用');
  }
  return ctx;
}

/**
 * 角色守卫 hook：用户角色不在 allowedRoles 内时重定向到 /chat，
 * 并返回 null（调用方应渲染加载态，避免越权内容闪现）。
 */
export function useRequireRole(allowedRoles: readonly string[]): AuthUser | null {
  const router = useRouter();
  const { user, status } = useAuth();
  const rolesKey = allowedRoles.join('|');
  const allowed = !!user && allowedRoles.includes(user.role);

  useEffect(() => {
    if (status === 'authed' && user && !rolesKey.split('|').includes(user.role)) {
      router.replace('/chat');
    }
  }, [status, user, rolesKey, router]);

  return allowed ? user : null;
}
