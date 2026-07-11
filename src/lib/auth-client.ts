/**
 * 客户端 Token 管理模块
 * Access Token 仅保存在浏览器内存（模块级变量），不写入 localStorage / sessionStorage
 */

let accessToken: string | null = null;

export function setAccessToken(token: string): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function clearAccessToken(): void {
  accessToken = null;
}

/**
 * 带鉴权的 fetch 封装
 * - 自动附加 Authorization: Bearer header
 * - 401 时尝试 refresh 一次，成功后重试原请求
 */
export async function authFetch(url: string, options?: RequestInit): Promise<Response> {
  const headers = new Headers(options?.headers ?? {});
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  let response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers.set('Authorization', `Bearer ${accessToken}`);
      response = await fetch(url, { ...options, headers });
    }
  }

  return response;
}

/**
 * 调用 /api/auth/refresh 刷新 Access Token
 * 成功返回 true 并更新内存中的 token；失败返回 false 并清空 token
 */
async function refreshAccessToken(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include', // 携带 refresh cookie
    });

    if (!res.ok) {
      clearAccessToken();
      return false;
    }

    const json = (await res.json()) as { data: { accessToken: string } };
    setAccessToken(json.data.accessToken);
    return true;
  } catch {
    clearAccessToken();
    return false;
  }
}
