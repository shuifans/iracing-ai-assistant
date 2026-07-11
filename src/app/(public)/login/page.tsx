'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { setAccessToken } from '@/lib/auth-client';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });

      const json = await res.json();

      if (!res.ok) {
        const msg =
          (json as { error?: { message?: string } }).error?.message ?? '登录失败，请稍后重试';
        setError(msg);
        return;
      }

      const token = (json as { data: { accessToken: string } }).data.accessToken;
      setAccessToken(token);
      router.push('/chat');
    } catch {
      setError('网络异常，请检查网络连接后重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-md sm:p-8">
      {/* Logo / Title */}
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900">iRacing AI 助手</h1>
        <p className="mt-1 text-sm text-gray-600">登录您的账户</p>
      </div>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {/* Username */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="login-username" className="text-sm font-medium text-gray-700">
            用户名
          </label>
          <input
            id="login-username"
            type="text"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="h-11 rounded-lg border border-gray-300 px-3 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            placeholder="请输入用户名"
          />
        </div>

        {/* Password */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="login-password" className="text-sm font-medium text-gray-700">
            密码
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 rounded-lg border border-gray-300 px-3 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            placeholder="请输入密码"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          className="flex h-11 w-full items-center justify-center rounded-lg bg-blue-600 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? '登录中…' : '登录'}
        </button>
      </form>

      {/* Register link */}
      <p className="mt-6 text-center text-sm text-gray-600">
        还没有账户？{' '}
        <Link
          href="/register"
          className="font-semibold text-blue-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-2 rounded"
        >
          立即注册
        </Link>
      </p>
    </div>
  );
}
