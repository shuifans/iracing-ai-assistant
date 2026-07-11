/**
 * Bootstrap Admin Script
 *
 * 用法：
 *   BOOTSTRAP_ADMIN_USERNAME=admin BOOTSTRAP_ADMIN_PASSWORD=securepassword123 npx tsx scripts/bootstrap-admin.ts
 *
 * 约束：
 * - 已存在任意 admin 角色用户时拒绝执行
 * - 创建的用户 role='admin', status='active'
 * - 密码使用 bcrypt cost=12
 */

import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { users } from '@/db/schema/users';
import { hashPassword } from '@/modules/auth/password';
import { generateId } from '@/lib/uuid';
import { utcNow } from '@/lib/datetime';

export interface BootstrapResult {
  success: boolean;
  message: string;
}

export async function bootstrapAdmin(): Promise<BootstrapResult> {
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  // 1. 读取环境变量
  if (!username || !password) {
    return { success: false, message: '缺少 BOOTSTRAP_ADMIN_USERNAME 或 BOOTSTRAP_ADMIN_PASSWORD 环境变量' };
  }

  // 2. 校验长度
  if (username.length < 3 || username.length > 32) {
    return { success: false, message: '用户名长度必须在 3-32 个字符之间' };
  }
  if (password.length < 10 || password.length > 72) {
    return { success: false, message: '密码长度必须在 10-72 个字符之间' };
  }

  const db = getDb();

  // 3. 是否已存在 admin
  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`${users.role} = 'admin'`)
    .limit(1);

  if (admins.length > 0) {
    return { success: false, message: '系统中已存在管理员，拒绝执行' };
  }

  // 4. 用户名是否已被占用（COLLATE NOCASE）
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`${users.username} COLLATE NOCASE = ${username}`)
    .limit(1);

  if (existing.length > 0) {
    return { success: false, message: '用户名已存在' };
  }

  // 5. Hash 密码
  const passwordHash = await hashPassword(password);

  // 6. 插入 users 表
  const now = utcNow();
  const id = generateId();

  await db.insert(users).values({
    id,
    username,
    passwordHash,
    role: 'admin',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    approvedAt: now,
  });

  // 7. 成功
  return { success: true, message: `管理员 ${username} 创建成功。请立即移除 BOOTSTRAP_ADMIN_PASSWORD 环境变量。` };
}

// 直接运行时执行
const isDirectRun = process.argv[1]?.endsWith('bootstrap-admin.ts')
  || process.argv[1]?.endsWith('bootstrap-admin');

if (isDirectRun) {
  bootstrapAdmin().then((result) => {
    if (result.success) {
      console.log(result.message);
    } else {
      console.error(result.message);
      process.exit(1);
    }
  }).catch((err: unknown) => {
    console.error('Bootstrap 脚本执行失败:', err);
    process.exit(1);
  });
}
