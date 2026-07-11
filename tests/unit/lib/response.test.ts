import { describe, it, expect } from 'vitest';
import { successResponse, errorResponse } from '@/lib/response';
import { AppError } from '@/lib/errors';

describe('successResponse', () => {
  it('wraps data with requestId and null cursor', () => {
    const res = successResponse({ items: [] });
    expect(res.data).toEqual({ items: [] });
    expect(res.meta.requestId).toBeTruthy();
    expect(res.meta.nextCursor).toBeNull();
  });

  it('accepts custom requestId', () => {
    const res = successResponse({}, undefined, 'custom-id');
    expect(res.meta.requestId).toBe('custom-id');
  });

  it('accepts pagination cursor', () => {
    const res = successResponse([], { nextCursor: 'abc123' });
    expect(res.meta.nextCursor).toBe('abc123');
  });
});

describe('errorResponse', () => {
  it('formats AppError into error envelope', () => {
    const err = new AppError('VALIDATION_ERROR', '参数不正确', { field: 'name' });
    const res = errorResponse(err);
    expect(res.error.code).toBe('VALIDATION_ERROR');
    expect(res.error.message).toBe('参数不正确');
    expect(res.error.fields).toEqual({ field: 'name' });
    expect(res.requestId).toBeTruthy();
  });

  it('accepts custom requestId', () => {
    const err = new AppError('NOT_FOUND');
    const res = errorResponse(err, 'req-123');
    expect(res.requestId).toBe('req-123');
  });
});
