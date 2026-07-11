import type { NextRequest, NextResponse } from 'next/server';

// ─── Constants ───────────────────────────────────────────────────────────────

export const REFRESH_COOKIE_NAME = 'refresh_token';

export const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/api/auth',
  maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
};

// ─── Cookie 操作 ─────────────────────────────────────────────────────────────

/**
 * 在 response 上设置 Refresh Token cookie。
 */
export function setRefreshCookie(response: NextResponse, rawToken: string): void {
  response.cookies.set(REFRESH_COOKIE_NAME, rawToken, REFRESH_COOKIE_OPTIONS);
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
