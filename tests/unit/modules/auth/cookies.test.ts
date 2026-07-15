import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setRefreshCookie,
  clearRefreshCookie,
  getRefreshCookie,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_OPTIONS,
  getRefreshCookieOptions,
} from '@/modules/auth/cookies';

// ─── Mock 对象 ──────────────────────────────────────────────────────────────

function createMockResponse() {
  return {
    cookies: {
      set: vi.fn(),
      delete: vi.fn(),
    },
  };
}

function createMockRequest(cookieValue?: string) {
  return {
    cookies: {
      get: vi.fn().mockReturnValue(cookieValue ? { value: cookieValue } : undefined),
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('setRefreshCookie', () => {
  beforeEach(() => vi.clearAllMocks());

  it('设置正确的 cookie 名称、值和属性', () => {
    const response = createMockResponse();
    const rawToken = 'test-refresh-token-value';

    setRefreshCookie(response as any, rawToken);

    expect(response.cookies.set).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      rawToken,
      REFRESH_COOKIE_OPTIONS,
    );

    // 验证 cookie 选项
    const [, , options] = response.cookies.set.mock.calls[0]!;
    expect(options.httpOnly).toBe(true);
    expect(options.secure).toBe(false);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/api/auth');
    expect(options.maxAge).toBe(7 * 24 * 60 * 60); // 604800 秒
  });

  it('生产默认使用 Secure，并允许本地 E2E 显式关闭', () => {
    try {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('REFRESH_COOKIE_SECURE', '');
      expect(getRefreshCookieOptions().secure).toBe(true);
      vi.stubEnv('REFRESH_COOKIE_SECURE', 'false');
      expect(getRefreshCookieOptions().secure).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('clearRefreshCookie', () => {
  it('删除 refresh_token cookie', () => {
    const response = createMockResponse();

    clearRefreshCookie(response as any);

    expect(response.cookies.delete).toHaveBeenCalledWith(REFRESH_COOKIE_NAME);
  });
});

describe('getRefreshCookie', () => {
  it('读取存在的 cookie 值', () => {
    const request = createMockRequest('my-refresh-token');

    const value = getRefreshCookie(request as any);

    expect(value).toBe('my-refresh-token');
    expect(request.cookies.get).toHaveBeenCalledWith(REFRESH_COOKIE_NAME);
  });

  it('cookie 不存在时返回 undefined', () => {
    const request = createMockRequest(undefined);

    const value = getRefreshCookie(request as any);

    expect(value).toBeUndefined();
  });
});
