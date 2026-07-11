import type { AppError } from '@/lib/errors';
import { generateId } from '@/lib/uuid';

export interface SuccessEnvelope<T> {
  data: T;
  meta: {
    requestId: string;
    nextCursor: string | null;
  };
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
  requestId: string;
}

export interface PaginationParams {
  limit?: number;
  cursor?: string;
}

export function successResponse<T>(
  data: T,
  meta?: { nextCursor?: string | null },
  requestId?: string,
): SuccessEnvelope<T> {
  return {
    data,
    meta: {
      requestId: requestId ?? generateId(),
      nextCursor: meta?.nextCursor ?? null,
    },
  };
}

export function errorResponse(error: AppError, requestId?: string): ErrorEnvelope {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.fields && { fields: error.fields }),
    },
    requestId: requestId ?? generateId(),
  };
}
