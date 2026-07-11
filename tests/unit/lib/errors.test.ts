import { describe, it, expect } from 'vitest';
import { AppError, isAppError } from '@/lib/errors';

describe('AppError', () => {
  it('creates error with code and default HTTP status', () => {
    const err = new AppError('VALIDATION_ERROR');
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.httpStatus).toBe(400);
    expect(err.message).toBeTruthy();
  });

  it('creates error with custom message', () => {
    const err = new AppError('NOT_FOUND', '用户不存在');
    expect(err.message).toBe('用户不存在');
    expect(err.httpStatus).toBe(404);
  });

  it('creates error with field-level details', () => {
    const err = new AppError('VALIDATION_ERROR', '字段校验失败', { username: '用户名已存在' });
    expect(err.fields).toEqual({ username: '用户名已存在' });
  });

  it('static fromCode works the same as constructor', () => {
    const err = AppError.fromCode('RATE_LIMITED');
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.httpStatus).toBe(429);
  });

  it('extends Error', () => {
    const err = new AppError('FORBIDDEN');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AppError');
  });
});

describe('isAppError', () => {
  it('returns true for AppError instances', () => {
    expect(isAppError(new AppError('NOT_FOUND'))).toBe(true);
  });

  it('returns false for regular Error', () => {
    expect(isAppError(new Error('test'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isAppError(null)).toBe(false);
    expect(isAppError('string')).toBe(false);
    expect(isAppError(42)).toBe(false);
  });
});
