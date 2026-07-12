'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { MIN_PASSWORD_LENGTH } from '@/modules/auth/constants';
import { validateRegisterForm } from '@/app/(public)/register/validation';

export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [registrationReason, setRegistrationReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const validationError = validateRegisterForm(username, password, confirmPassword);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);

    try {
      const body: Record<string, string> = { username, password };
      if (registrationReason.trim()) {
        body.registrationReason = registrationReason.trim();
      }

      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        const msg =
          (json as { error?: { message?: string } } | null)?.error?.message ??
          '服务器错误，请稍后重试';
        setError(msg);
        return;
      }

      setSuccess(true);
    } catch {
      setError('网络异常，请检查网络连接后重试');
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-md sm:p-8">
        <div className="flex flex-col items-center text-center">
          <div
            className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100"
            aria-hidden="true"
          >
            <svg
              className="h-7 w-7 text-green-600"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900">注册申请已提交</h1>
          <p className="mt-2 text-sm text-gray-600">请等待管理员审批，审批通过后方可登录。</p>
          <Link
            href="/login"
            className="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-blue-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-2"
          >
            返回登录
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-md sm:p-8">
      {/* Title */}
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900">iRacing AI 助手</h1>
        <p className="mt-1 text-sm text-gray-600">创建新账户</p>
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
          <label htmlFor="reg-username" className="text-sm font-medium text-gray-700">
            用户名
          </label>
          <input
            id="reg-username"
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
          <label htmlFor="reg-password" className="text-sm font-medium text-gray-700">
            密码
          </label>
          <input
            id="reg-password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 rounded-lg border border-gray-300 px-3 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            placeholder={`至少 ${MIN_PASSWORD_LENGTH} 位`}
          />
        </div>

        {/* Confirm Password */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reg-confirm-password" className="text-sm font-medium text-gray-700">
            确认密码
          </label>
          <input
            id="reg-confirm-password"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="h-11 rounded-lg border border-gray-300 px-3 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            placeholder="请再次输入密码"
          />
        </div>

        {/* Registration Reason (optional) */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reg-reason" className="text-sm font-medium text-gray-700">
            注册理由
            <span className="ml-1 text-xs font-normal text-gray-400">（选填）</span>
          </label>
          <textarea
            id="reg-reason"
            rows={3}
            value={registrationReason}
            onChange={(e) => setRegistrationReason(e.target.value)}
            className="min-h-[76px] resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            placeholder="简述您注册的原因（可选）"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          className="flex h-11 w-full items-center justify-center rounded-lg bg-blue-600 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? '提交中…' : '提交注册申请'}
        </button>
      </form>

      {/* Login link */}
      <p className="mt-6 text-center text-sm text-gray-600">
        已有账户？{' '}
        <Link
          href="/login"
          className="font-semibold text-blue-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-2 rounded"
        >
          立即登录
        </Link>
      </p>
    </div>
  );
}
