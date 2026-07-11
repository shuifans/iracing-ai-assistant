import { eq, and, sql, like, lt, or } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { users, refreshTokens } from '@/db/schema/users';
import { chatSessions } from '@/db/schema/chat';
import { usageEvents } from '@/db/schema/admin';
import { knowledgeSources } from '@/db/schema/knowledge';
import { AppError } from '@/lib/errors';
import { utcNow } from '@/lib/datetime';
import type { User } from '@/db/schema/users';
import type { UserListParams, UserListResult, UserSummary } from './types';

// ── helpers ──────────────────────────────────────────────────────────────────

function toUserSummary(u: User): UserSummary {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    status: u.status,
    registrationReason: u.registrationReason,
    rejectionReason: u.rejectionReason,
    createdAt: u.createdAt,
    approvedAt: u.approvedAt,
    lastLoginAt: u.lastLoginAt,
  };
}

// ── countActiveAdmins ────────────────────────────────────────────────────────

export async function countActiveAdmins(): Promise<number> {
  const db = getDb();
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.status, 'active')));
  return Number(result[0]?.count ?? 0);
}

// ── approveUser ──────────────────────────────────────────────────────────────

export async function approveUser(
  userId: string,
  approvedBy: string,
): Promise<User> {
  const db = getDb();
  const now = utcNow();
  const result = await db
    .update(users)
    .set({
      status: 'active' as const,
      approvedAt: now,
      approvedBy,
      updatedAt: now,
    })
    .where(and(eq(users.id, userId), eq(users.status, 'pending' as const)))
    .returning();
  if (!result.length) {
    throw new AppError('NOT_FOUND', 'User not found or not in pending status');
  }
  return result[0]!;
}

// ── rejectUser ───────────────────────────────────────────────────────────────

export async function rejectUser(
  userId: string,
  reason: string,
): Promise<User> {
  const db = getDb();
  const now = utcNow();
  const result = await db
    .update(users)
    .set({
      status: 'rejected' as const,
      rejectionReason: reason,
      updatedAt: now,
    })
    .where(and(eq(users.id, userId), eq(users.status, 'pending' as const)))
    .returning();
  if (!result.length) {
    throw new AppError('NOT_FOUND', 'User not found or not in pending status');
  }
  return result[0]!;
}

// ── disableUser ──────────────────────────────────────────────────────────────

export async function disableUser(userId: string): Promise<User> {
  const db = getDb();
  const user = await getUserById(userId);
  if (!user) {
    throw new AppError('NOT_FOUND', 'User not found');
  }
  if (user.role === 'admin' && user.status === 'active') {
    const count = await countActiveAdmins();
    if (count <= 1) {
      throw new AppError('FORBIDDEN', '系统中最后一个管理员不能被禁用、降权或删除');
    }
  }
  const now = utcNow();
  const result = await db
    .update(users)
    .set({ status: 'disabled' as const, updatedAt: now })
    .where(eq(users.id, userId))
    .returning();
  return result[0]!;
}

// ── enableUser ───────────────────────────────────────────────────────────────

export async function enableUser(userId: string): Promise<User> {
  const db = getDb();
  const now = utcNow();
  const result = await db
    .update(users)
    .set({ status: 'active' as const, updatedAt: now })
    .where(and(eq(users.id, userId), eq(users.status, 'disabled' as const)))
    .returning();
  if (!result.length) {
    throw new AppError('NOT_FOUND', 'User not found or not in disabled status');
  }
  return result[0]!;
}

// ── deleteUser ───────────────────────────────────────────────────────────────

export async function deleteUser(userId: string): Promise<void> {
  const db = getDb();
  const user = await getUserById(userId);
  if (!user) {
    throw new AppError('NOT_FOUND', 'User not found');
  }
  if (user.role === 'admin' && user.status === 'active') {
    const count = await countActiveAdmins();
    if (count <= 1) {
      throw new AppError('FORBIDDEN', '系统中最后一个管理员不能被禁用、降权或删除');
    }
  }
  // Cascade: refresh_tokens (no ON DELETE CASCADE in schema)
  await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
  // Cascade: usage_events (no ON DELETE CASCADE in schema)
  await db.delete(usageEvents).where(eq(usageEvents.userId, userId));
  // knowledge_sources submitted_by — nullify
  await db
    .update(knowledgeSources)
    .set({ submittedBy: '' })
    .where(eq(knowledgeSources.submittedBy, userId));
  // chat_sessions -> messages -> attachments/sources/feedback cascade via FK
  await db.delete(chatSessions).where(eq(chatSessions.userId, userId));
  // Delete the user
  await db.delete(users).where(eq(users.id, userId));
}

// ── changeUserRole ───────────────────────────────────────────────────────────

export async function changeUserRole(
  userId: string,
  newRole: string,
): Promise<User> {
  const db = getDb();
  const user = await getUserById(userId);
  if (!user) {
    throw new AppError('NOT_FOUND', 'User not found');
  }
  // Last-admin protection when demoting admin → non-admin
  if (user.role === 'admin' && newRole !== 'admin' && user.status === 'active') {
    const count = await countActiveAdmins();
    if (count <= 1) {
      throw new AppError('FORBIDDEN', '系统中最后一个管理员不能被禁用、降权或删除');
    }
  }
  const now = utcNow();
  const result = await db
    .update(users)
    .set({ role: newRole as User['role'], updatedAt: now })
    .where(eq(users.id, userId))
    .returning();
  return result[0]!;
}

// ── getUserById ──────────────────────────────────────────────────────────────

export async function getUserById(userId: string): Promise<User | null> {
  const db = getDb();
  const result = await db.select().from(users).where(eq(users.id, userId));
  return result[0] ?? null;
}

// ── listUsers ────────────────────────────────────────────────────────────────

export async function listUsers(params: UserListParams = {}): Promise<UserListResult> {
  const db = getDb();
  const { status, role, search, limit = 20, cursor } = params;

  const conditions = [];
  if (status) conditions.push(eq(users.status, status as User['status']));
  if (role) conditions.push(eq(users.role, role as User['role']));
  if (search) {
    conditions.push(
      or(
        like(users.username, `%${search}%`),
        like(users.registrationReason, `%${search}%`),
      )!,
    );
  }
  if (cursor) conditions.push(lt(users.id, cursor));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(users)
    .where(whereClause)
    .orderBy(sql`${users.createdAt} DESC`)
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const resultRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    users: resultRows.map(toUserSummary),
    nextCursor: hasMore ? resultRows[resultRows.length - 1]!.id : null,
  };
}

// ── listPendingUsers ─────────────────────────────────────────────────────────

export async function listPendingUsers(): Promise<UserSummary[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.status, 'pending' as const))
    .orderBy(sql`${users.createdAt} ASC`);
  return rows.map(toUserSummary);
}
