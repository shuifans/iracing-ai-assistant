import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
  validateOrigin,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { submitUrlSource } from '@/modules/knowledge/service';
import { submitUrlSchema } from '@/modules/knowledge/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/knowledge/sources/url — submit a URL knowledge source.
 */
export const POST = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const user = await requireAuth(request);
  requireRole(user, 'knowledge_admin', 'admin');
  requireActiveUser(user);
  validateOrigin(request);

  // 1. Parse JSON body
  const body = await request.json();

  // 2. Validate with Zod schema
  const parsed = submitUrlSchema.parse(body);

  // 3. Submit URL source
  const result = await submitUrlSource({
    url: parsed.url,
    title: parsed.title,
    submittedBy: user.id,
  });

  // 4. Return 201
  return NextResponse.json(successResponse(result), { status: 201 });
});
