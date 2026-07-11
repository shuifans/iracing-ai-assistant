import { sqliteTable, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { USER_ROLES, USER_STATUSES } from '../../config/constants';

// ─── users ───────────────────────────────────────────────────────────────────

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: USER_ROLES }).notNull(),
    status: text('status', { enum: USER_STATUSES }).notNull(),
    registrationReason: text('registration_reason'),
    rejectionReason: text('rejection_reason'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    approvedAt: text('approved_at'),
    lastLoginAt: text('last_login_at'),
    // Self-referencing FK: approved_by -> users.id (FK constraint added in migration)
    approvedBy: text('approved_by'),
  },
  (table) => [
    uniqueIndex('idx_users_username').on(table.username),
    index('idx_users_status').on(table.status),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ─── refresh_tokens ──────────────────────────────────────────────────────────

export const refreshTokens = sqliteTable(
  'refresh_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    familyId: text('family_id').notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
    revokedAt: text('revoked_at'),
    replacedBy: text('replaced_by'),
    userAgent: text('user_agent'),
    ipHash: text('ip_hash'),
  },
  (table) => [
    uniqueIndex('idx_refresh_tokens_token_hash').on(table.tokenHash),
    index('idx_refresh_tokens_user_id').on(table.userId),
    index('idx_refresh_tokens_family_id').on(table.familyId),
    index('idx_refresh_tokens_expires_at').on(table.expiresAt),
  ],
);

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
