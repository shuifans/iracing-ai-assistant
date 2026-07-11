import { NextResponse } from 'next/server';
import fs from 'fs';
import { env } from '@/config/env';
import { getDb } from '@/db/client';
import { sql } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, boolean> = {
    pat: false,
    wiki: false,
    database: false,
  };

  // Check PAT configured
  checks.pat = !!env.QODER_PERSONAL_ACCESS_TOKEN;

  // Check Wiki directory readable
  try {
    fs.accessSync(env.WIKI_ROOT, fs.constants.R_OK);
    checks.wiki = true;
  } catch {
    checks.wiki = false;
  }

  // Check database connection
  try {
    const db = getDb();
    db.run(sql`SELECT 1`);
    checks.database = true;
  } catch {
    checks.database = false;
  }

  const ready = checks.pat && checks.wiki && checks.database;

  return NextResponse.json(
    {
      status: ready ? 'ready' : 'not_ready',
      checks,
    },
    { status: ready ? 200 : 503 },
  );
}
