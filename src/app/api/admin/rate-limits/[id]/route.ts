import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
  validateOrigin,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { updateRateLimitConfig } from '@/modules/rate-limit/service';
import { recordAudit } from '@/modules/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

export const PATCH = withErrorHandler(
  async (request: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    validateOrigin(request);
    const user = await requireAuth(request);
    requireRole(user, 'admin');
    requireActiveUser(user);

    const id = context!.params.id;
    const body = await request.json();

    const { perMinuteLimit, perDayLimit, maxSessionTurns, enabled } = body;

    const changes: Record<string, any> = {};
    if (perMinuteLimit !== undefined) changes.perMinuteLimit = perMinuteLimit;
    if (perDayLimit !== undefined) changes.perDayLimit = perDayLimit;
    if (maxSessionTurns !== undefined) changes.maxSessionTurns = maxSessionTurns;
    if (enabled !== undefined) changes.enabled = enabled;

    const config = updateRateLimitConfig(id, changes);

    recordAudit({
      actorId: user.id,
      action: 'rate_limit.updated',
      resource: 'rate_limit_config',
      resourceId: id,
      changes,
    });

    return NextResponse.json(successResponse({ config }));
  },
);
