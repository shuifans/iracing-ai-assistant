import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { users, type User } from '@/db/schema/users';
import { AppError } from '@/lib/errors';
import { generateId } from '@/lib/uuid';
import { utcNow } from '@/lib/datetime';
import { hashPassword, verifyPassword } from './password';
import type { AuthenticatedUser } from './types';

/**
 * 注册新用户。
 * - 用户名唯一校验（不区分大小写）
 * - 密码 bcrypt hash (cost=12)
 * - 状态固定为 pending，角色为 user
 */
export async function registerUser(
  username: string,
  password: string,
  registrationReason?: string,
): Promise<User> {
  const db = getDb();

  // 唯一性校验（COLLATE NOCASE）
  const existing = await db
    .select()
    .from(users)
    .where(sql`${users.username} COLLATE NOCASE = ${username}`)
    .limit(1);

  if (existing.length > 0) {
    throw AppError.fromCode('CONFLICT', '用户名已存在');
  }

  const passwordHash = await hashPassword(password);
  const now = utcNow();
  const id = generateId();

  const [newUser] = await db
    .insert(users)
    .values({
      id,
      username,
      passwordHash,
      role: 'user',
      status: 'pending',
      registrationReason: registrationReason ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return newUser!;
}

/**
 * 验证用户凭据。
 * - 用户名不区分大小写查找
 * - 不存在或密码错误统一抛 INVALID_CREDENTIALS（不泄露用户名是否存在）
 * - 用户状态检查：pending → ACCOUNT_PENDING, disabled → ACCOUNT_DISABLED
 */
export async function validateCredentials(
  username: string,
  password: string,
): Promise<AuthenticatedUser> {
  const db = getDb();

  const [user] = await db
    .select()
    .from(users)
    .where(sql`${users.username} COLLATE NOCASE = ${username}`)
    .limit(1);

  if (!user) {
    throw AppError.fromCode('INVALID_CREDENTIALS', '用户名或密码错误');
  }

  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    throw AppError.fromCode('INVALID_CREDENTIALS', '用户名或密码错误');
  }

  if (user.status === 'pending') {
    throw AppError.fromCode('ACCOUNT_PENDING', '账号等待审批');
  }

  if (user.status === 'disabled') {
    throw AppError.fromCode('ACCOUNT_DISABLED', '账号已被禁用');
  }

  return {
    id: user.id,
    username: user.username,
    role: user.role as AuthenticatedUser['role'],
    status: 'active',
  };
}
