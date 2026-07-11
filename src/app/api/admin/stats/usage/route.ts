import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { getUsageTrend } from '@/modules/analytics/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const user = await requireAuth(request);
  requireRole(user, 'admin');
  requireActiveUser(user);

  const url = new URL(request.url);
  const periodParam = url.searchParams.get('period') ?? 'day';
  const fromDate = url.searchParams.get('fromDate') ?? undefined;
  const toDate = url.searchParams.get('toDate') ?? undefined;

  const validPeriods = ['day', 'week', 'month'] as const;
  const period = validPeriods.includes(periodParam as 'day' | 'week' | 'month')
    ? (periodParam as 'day' | 'week' | 'month')
    : 'day';

  const data = getUsageTrend({ period, fromDate, toDate });

  return NextResponse.json(successResponse(data));
});
