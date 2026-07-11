import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { createHash, randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { refreshTokens } from '@/db/schema/users';
import { env } from '@/config/env';
import { AppError } from '@/lib/errors';
import { generateId } from '@/lib/uuid';
import { utcNow } from '@/lib/datetime';
import type { AuthenticatedUser } from './types';

// ─── Constants ───────────────────────────────────────────────────────────────

const ACCESS_TOKEN_EXPIRY = '30m';
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

// ─── Access Token (JWT) ─────────────────────────────────────────────────────

/**
 * 创建 JWT Access Token（HS256，30 分钟过期）。
 * Payload 只含 sub、role、status、jti。
 */
export async function createAccessToken(user: AuthenticatedUser): Promise<string> {
  const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

  return new SignJWT({
    sub: user.id,
    role: user.role,
    status: user.status,
    jti: generateId(),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(secret);
}

/**
 * 验证 Access Token 签名和过期时间。
 * 成功时返回 AuthenticatedUser，失败抛 UNAUTHENTICATED。
 */
export async function verifyAccessToken(token: string): Promise<AuthenticatedUser> {
  try {
    const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
    const { payload } = await jwtVerify(token, secret);

    return {
      id: payload.sub as string,
      username: '', // JWT payload 不包含 username，由调用方按需补充
      role: payload.role as AuthenticatedUser['role'],
      status: payload.status as AuthenticatedUser['status'],
    };
  } catch (err) {
    if (
      err instanceof joseErrors.JWTExpired ||
      err instanceof joseErrors.JWSSignatureVerificationFailed ||
      err instanceof joseErrors.JWTInvalid
    ) {
      throw AppError.fromCode('UNAUTHENTICATED', 'Token 无效或已过期');
    }
    throw AppError.fromCode('UNAUTHENTICATED', 'Token 验证失败');
  }
}

// ─── Refresh Token (不透明) ──────────────────────────────────────────────────

/**
 * 生成 256-bit 随机不透明 Refresh Token。
 * - 计算 SHA-256 hash 存入 refresh_tokens 表
 * - familyId 未提供时自动生成新 family
 * - 7 天过期
 * - 返回 { token: 原始值, tokenId, familyId }（原始值只返回一次）
 */
export async function createRefreshToken(
  userId: string,
  familyId?: string,
  userAgent?: string,
  ipHash?: string,
): Promise<{ token: string; tokenId: string; familyId: string }> {
  const rawToken = randomBytes(32).toString('hex'); // 256-bit
  const tokenHash = hashToken(rawToken);
  const tokenId = generateId();
  const resolvedFamilyId = familyId ?? generateId();
  const now = utcNow();

  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const db = getDb();
  await db.insert(refreshTokens).values({
    id: tokenId,
    userId,
    tokenHash,
    familyId: resolvedFamilyId,
    expiresAt,
    createdAt: now,
    revokedAt: null,
    replacedBy: null,
    userAgent: userAgent ?? null,
    ipHash: ipHash ?? null,
  });

  return { token: rawToken, tokenId, familyId: resolvedFamilyId };
}

/**
 * 轮换 Refresh Token。
 * - 计算 hash 查找现有 token
 * - 如果 token 已被 replaced_by（重放检测）→ 撤销整个 family，抛 TOKEN_REUSED
 * - 标记当前 token 为 revoked + replaced_by 新 token
 * - 创建新 token（同一 family）
 * - 返回 { token: 新原始值, tokenId, familyId }
 */
export async function rotateRefreshToken(
  rawToken: string,
): Promise<{ token: string; tokenId: string; familyId: string }> {
  const tokenHash = hashToken(rawToken);
  const db = getDb();

  // 查找当前 token 记录
  const [existing] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);

  if (!existing) {
    throw AppError.fromCode('UNAUTHENTICATED', 'Refresh Token 不存在');
  }

  // 重放检测：token 已被替换
  if (existing.replacedBy) {
    await revokeTokenFamily(existing.familyId);
    throw AppError.fromCode('TOKEN_REUSED', '检测到 Token 重放，已撤销整个 Token 家族');
  }

  // 检查是否已撤销
  if (existing.revokedAt) {
    throw AppError.fromCode('UNAUTHENTICATED', 'Refresh Token 已被撤销');
  }

  // 检查是否过期
  if (new Date(existing.expiresAt) < new Date()) {
    throw AppError.fromCode('UNAUTHENTICATED', 'Refresh Token 已过期');
  }

  // 创建新 token（同一 family）
  const result = await createRefreshToken(
    existing.userId,
    existing.familyId,
    existing.userAgent ?? undefined,
    existing.ipHash ?? undefined,
  );

  // 标记旧 token 为 replaced
  const now = utcNow();
  await db
    .update(refreshTokens)
    .set({ revokedAt: now, replacedBy: result.tokenId })
    .where(eq(refreshTokens.id, existing.id));

  return result;
}

/**
 * 撤销同一 family 下所有未过期的 refresh tokens。
 */
export async function revokeTokenFamily(familyId: string): Promise<void> {
  const db = getDb();
  const now = utcNow();

  await db
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(eq(refreshTokens.familyId, familyId));
}

// ─── Hash 工具 ───────────────────────────────────────────────────────────────

/**
 * SHA-256 hash（用于 Refresh Token）。
 */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * 使用 IP_HASH_PEPPER + SHA-256 hash IP 地址。
 */
export function hashIp(ip: string): string {
  return createHash('sha256').update(env.IP_HASH_PEPPER + ip).digest('hex');
}
