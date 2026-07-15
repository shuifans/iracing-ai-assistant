import type { NextRequest, NextResponse } from 'next/server';

// ─── Constants ───────────────────────────────────────────────────────────────

export const REFRESH_COOKIE_NAME = 'refresh_token';

export function getRefreshCookieOptions() {
  const configured = process.env.REFRESH_COOKIE_SECURE;
  const secure =
    configured === 'true'
      ? true
      : configured === 'false'
        ? false
        : process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60,
  };
}

export const REFRESH_COOKIE_OPTIONS = getRefreshCookieOptions();

// ─── Cookie 操作 ─────────────────────────────────────────────────────────────

/**
 * 在 response 上设置 Refresh Token cookie。
 */
export function setRefreshCookie(response: NextResponse, rawToken: string): void {
  response.cookies.set(REFRESH_COOKIE_NAME, rawToken, getRefreshCookieOptions());
}

/**
 * 清除 response 上的 Refresh Token cookie。
 */
export function clearRefreshCookie(response: NextResponse): void {
  response.cookies.delete(REFRESH_COOKIE_NAME);
}

/**
 * 从 request 中读取 Refresh Token cookie。
 */
export function getRefreshCookie(request: NextRequest): string | undefined {
  return request.cookies.get(REFRESH_COOKIE_NAME)?.value;
}
