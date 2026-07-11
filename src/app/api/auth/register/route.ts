import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { withErrorHandler, validateOrigin } from '@/modules/auth/middleware';
import { registerSchema } from '@/modules/auth/schemas';
import { registerUser } from '@/modules/auth/service';
import { successResponse } from '@/lib/response';
import { AppError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandler(async (request: NextRequest) => {
  validateOrigin(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError('VALIDATION_ERROR', '无效的 JSON 请求体');
  }

  try {
    const { username, password, registrationReason } = registerSchema.parse(body);
    await registerUser(username, password, registrationReason);

    return NextResponse.json(successResponse({ message: '注册申请已提交，请等待管理员审批' }), {
      status: 201,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      throw new AppError('VALIDATION_ERROR', err.issues.map((i) => i.message).join('; '));
    }
    throw err;
  }
});
