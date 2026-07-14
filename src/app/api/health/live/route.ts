import { NextResponse } from 'next/server';
import { getRawDb } from '@/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const APP_VERSION = process.env.npm_package_version ?? '0.1.0';

export async function GET() {
  try {
    const db = getRawDb();
    db.exec('SELECT 1');
    return NextResponse.json({
      status: 'ok',
      uptime: Math.round(process.uptime()),
      version: APP_VERSION,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ status: 'error' }, { status: 503 });
  }
}
