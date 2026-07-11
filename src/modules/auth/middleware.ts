import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken } from './token-service';
import type { AuthenticatedUser } from './types';
import { AppError } from '@/lib/errors';
import { errorResponse } from '@/lib/response';

// 扩展 NextRequest 以携带认证信息
declare module 'next/server' {
  interface NextRequest {
    user?: AuthenticatedUser;
  }
}

/**
 * 验证 Access Token 并将用户信息附加到请求。
 * 用于需要认证的 Route Handler。
 *
 * 用法：
 * export async function GET(request: NextRequest) {
 *   const user = await requireAuth(request);
 *   // user.id, user.role, user.status 可用
 * }
 */
export async function requireAuth(request: NextRequest): Promise<AuthenticatedUser> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AppError('UNAUTHENTICATED', '未提供认证令牌');
  }

  const token = authHeader.slice(7);
  const user = await verifyAccessToken(token);
  request.user = user;
  return user;
}

/**
 * 检查用户角色是否满足要求。
 *
 * 用法：
 * requireRole(user, 'admin');  // 仅 admin
 * requireRole(user, 'knowledge_admin', 'admin');  // knowledge_admin 或 admin
 */
export function requireRole(user: AuthenticatedUser, ...allowedRoles: string[]): void {
  if (!allowedRoles.includes(user.role)) {
    throw new AppError('FORBIDDEN', '权限不足');
  }
}

/**
 * 检查用户状态是否为 active。
 */
export function requireActiveUser(user: AuthenticatedUser): void {
  if (user.status !== 'active') {
    throw new AppError('ACCOUNT_DISABLED', '账户已被禁用');
  }
}

/**
 * 校验 Origin/Host 头防止 CSRF。
 * 用于所有状态修改接口（POST/PATCH/PUT/DELETE）。
 */
export function validateOrigin(request: NextRequest): void {
  // GET/HEAD/OPTIONS 不需要校验
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;

  const origin = request.headers.get('origin');
  const host = request.headers.get('host');

  // 无 Origin 头的同源请求（如表单提交）允许
  if (!origin) return;

  // Origin 和 Host 必须匹配
  try {
    const originHost = new URL(origin).host;
    if (originHost !== host) {
      throw new AppError('FORBIDDEN', '跨站请求被拒绝');
    }
  } catch (err) {
    // 如果 URL 解析失败（非 FORBIDDEN AppError），抛出 FORBIDDEN
    if (err instanceof AppError) throw err;
    throw new AppError('FORBIDDEN', '无效的 Origin 头');
  }
}

/**
 * Next.js Route Handler 的错误处理包装器。
 * 捕获 AppError 并转为标准 JSON 响应。
 */
export function withErrorHandler(
  handler: (request: NextRequest, context?: any) => Promise<NextResponse>,
) {
  return async (request: NextRequest, context?: any): Promise<NextResponse> => {
    try {
      return await handler(request, context);
    } catch (err) {
      if (err instanceof AppError) {
        return NextResponse.json(errorResponse(err), { status: err.httpStatus });
      }
      console.error('[API] Unexpected error:', err);
      const internalError = new AppError('SERVICE_NOT_READY', '服务内部错误');
      return NextResponse.json(errorResponse(internalError), { status: 500 });
    }
  };
}
