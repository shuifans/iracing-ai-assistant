import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { getDb } from '@/db/client';
import { knowledgeJobs } from '@/db/schema/knowledge';
import { sql, inArray } from 'drizzle-orm';
import { env } from '@/config/env';
import fs from 'fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const user = await requireAuth(request);
  requireRole(user, 'admin');
  requireActiveUser(user);

  // 1. Database check
  let database: 'ok' | 'error' = 'error';
  try {
    const db = getDb();
    db.run(sql`SELECT 1`);
    database = 'ok';
  } catch {
    database = 'error';
  }

  // 2. Worker check — look for active job leases
  let worker: 'running' | 'stopped' = 'stopped';
  try {
    const db = getDb();
    const activeLeases = db
      .select({ id: knowledgeJobs.id })
      .from(knowledgeJobs)
      .where(inArray(knowledgeJobs.status, ['extracting', 'cleaning', 'publishing']))
      .all();
    if (activeLeases.length > 0) {
      worker = 'running';
    }
  } catch {
    // keep 'stopped'
  }

  // 3. Disk usage check
  let disk: { usagePercent: number; availableGB: number } | null = null;
  try {
    const dataRoot = env.DATA_ROOT as string;
    const stats = fs.statfsSync(dataRoot);
    const usagePercent = Math.round(((stats.blocks - stats.bfree) / stats.blocks) * 100);
    const availableGB = Math.round((stats.bavail * stats.bsize) / (1024 * 1024 * 1024));
    disk = { usagePercent, availableGB };
  } catch {
    // disk check failed — leave as null
  }

  return NextResponse.json(
    successResponse({
      database,
      worker,
      disk,
    }),
  );
});
