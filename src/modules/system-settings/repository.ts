/**
 * System-settings repository — generic key/value store over `system_settings`.
 *
 * The `system_settings` table is a one-row-per-setting key/value store
 * (unique index on `key`); values are TEXT (booleans as 'true'/'false',
 * numbers as stringified ints; coercion at read time). All functions are
 * synchronous (better-sqlite3 is sync).
 *
 * Reusable building blocks for runtime-switchable settings (DB-backed, so a
 * change takes effect for the next read without a process restart — unlike
 * env-backed settings).
 *
 * @module system-settings/repository
 */

import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { systemSettings } from '@/db/schema';
import { generateId } from '@/lib/uuid';
import { utcNow } from '@/lib/datetime';

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

export function getSetting(key: string, defaultValue?: string): string | undefined {
  const db = getDb();
  const row = db.select().from(systemSettings).where(eq(systemSettings.key, key)).get();
  return row?.value ?? defaultValue;
}

export function upsertSetting(params: { key: string; value: string; description?: string }): void {
  const db = getDb();
  const now = utcNow();
  db.insert(systemSettings)
    .values({
      id: generateId(),
      key: params.key,
      value: params.value,
      description: params.description ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: {
        value: params.value,
        description: params.description ?? null,
        updatedAt: now,
      },
    })
    .run();
}
