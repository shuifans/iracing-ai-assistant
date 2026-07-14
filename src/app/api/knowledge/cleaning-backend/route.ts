/**
 * Knowledge cleaning-backend switch — password-gated.
 *
 * GET  — return the current cleaning backend (default 'llm-direct' = LongCat).
 * POST — switch the backend. Requires a password verified against the bcrypt
 *        hash in `MODEL_SWITCH_PASSWORD_HASH`. Only the super-admin who knows
 *        the plaintext can switch; other admins (who can't) are locked to the
 *        default LLM path. The choice persists to system_settings and takes
 *        effect for the next cleaning job (worker reads it per-job).
 *
 * Auth: knowledge_admin | admin. The role gate lets any admin VIEW the current
 * backend; switching still needs the password.
 *
 * @route /api/knowledge/cleaning-backend
 */

import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import {
  withErrorHandler,
  requireAuth,
  requireRole,
  requireActiveUser,
  validateOrigin,
} from '@/modules/auth/middleware';
import { successResponse } from '@/lib/response';
import { AppError } from '@/lib/errors';
import { env } from '@/config/env';
import { verifyPassword } from '@/modules/auth/password';
import {
  getCleaningBackend,
  upsertSetting,
  CLEANING_BACKENDS,
  CLEANING_BACKEND_KEY,
} from '@/modules/system-settings/repository';
import { recordAudit } from '@/modules/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const switchSchema = z.object({
  backend: z.enum(CLEANING_BACKENDS),
  password: z.string().min(1, '密码不能为空').max(200, '密码过长'),
});

// GET — current backend
export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const user = await requireAuth(request);
  requireRole(user, 'knowledge_admin', 'admin');
  requireActiveUser(user);

  return NextResponse.json(successResponse({ backend: getCleaningBackend() }));
});

// POST — password-gated switch
export const POST = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  validateOrigin(request);
  const user = await requireAuth(request);
  requireRole(user, 'knowledge_admin', 'admin');
  requireActiveUser(user);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError('VALIDATION_ERROR', '无效的 JSON 请求体');
  }

  let parsed: z.infer<typeof switchSchema>;
  try {
    parsed = switchSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new AppError('VALIDATION_ERROR', err.issues.map((i) => i.message).join('; '));
    }
    throw err;
  }

  // Guard before bcrypt.compare — verifyPassword(pw, undefined) throws.
  // Return the same FORBIDDEN for "not configured" and "wrong password" to
  // avoid user-enumeration.
  const hash = env.MODEL_SWITCH_PASSWORD_HASH;
  if (!hash) {
    throw new AppError('FORBIDDEN', '切换未配置或密码错误');
  }
  const ok = await verifyPassword(parsed.password, hash);
  if (!ok) {
    throw new AppError('FORBIDDEN', '切换未配置或密码错误');
  }

  const from = getCleaningBackend();
  upsertSetting({
    key: CLEANING_BACKEND_KEY,
    value: parsed.backend,
    description: '知识清洗后端 (llm-direct=LongCat | qoder-sdk=Qwen3.7-Plus)',
  });

  try {
    recordAudit({
      actorId: user.id,
      action: 'settings.updated',
      resource: 'system_setting',
      resourceId: CLEANING_BACKEND_KEY,
      requestId: request.headers.get('x-request-id') ?? undefined,
      ipHash: request.headers.get('x-forwarded-for') ?? undefined,
      changes: { from, to: parsed.backend },
    });
  } catch {
    /* audit failure must not break the switch */
  }

  return NextResponse.json(successResponse({ backend: parsed.backend, previousBackend: from }));
});
