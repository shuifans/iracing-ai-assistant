import { describe, it, expect } from 'vitest';
import { registerSchema, loginSchema } from '@/modules/auth/schemas';

describe('registerSchema', () => {
  it('合法注册数据通过校验', () => {
    const result = registerSchema.safeParse({
      username: 'testuser',
      password: 'secure-password',
    });
    expect(result.success).toBe(true);
  });

  it('用户名 < 3 字符失败', () => {
    const result = registerSchema.safeParse({
      username: 'ab',
      password: 'secure-password',
    });
    expect(result.success).toBe(false);
  });

  it('用户名 > 32 字符失败', () => {
    const result = registerSchema.safeParse({
      username: 'a'.repeat(33),
      password: 'secure-password',
    });
    expect(result.success).toBe(false);
  });

  it('用户名含特殊字符失败', () => {
    const result = registerSchema.safeParse({
      username: 'user@name!',
      password: 'secure-password',
    });
    expect(result.success).toBe(false);
  });

  it('中文用户名通过', () => {
    const result = registerSchema.safeParse({
      username: '赛车手小王',
      password: 'secure-password',
    });
    expect(result.success).toBe(true);
  });

  it('密码 < 10 字符失败', () => {
    const result = registerSchema.safeParse({
      username: 'testuser',
      password: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('registrationReason > 500 字符失败', () => {
    const result = registerSchema.safeParse({
      username: 'testuser',
      password: 'secure-password',
      registrationReason: 'a'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('可选 registrationReason 不传时通过', () => {
    const result = registerSchema.safeParse({
      username: 'testuser',
      password: 'secure-password',
    });
    expect(result.success).toBe(true);
  });
});

describe('loginSchema', () => {
  it('合法登录数据通过校验', () => {
    const result = loginSchema.safeParse({
      username: 'testuser',
      password: 'some-password',
    });
    expect(result.success).toBe(true);
  });

  it('空用户名失败', () => {
    const result = loginSchema.safeParse({
      username: '',
      password: 'some-password',
    });
    expect(result.success).toBe(false);
  });

  it('空密码失败', () => {
    const result = loginSchema.safeParse({
      username: 'testuser',
      password: '',
    });
    expect(result.success).toBe(false);
  });
});
