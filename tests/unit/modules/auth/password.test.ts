import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '@/modules/auth/password';

describe('password', () => {
  it('hashPassword 返回 bcrypt hash（以 $2b$12$ 开头）', async () => {
    const hash = await hashPassword('valid-password-123');
    expect(hash).toMatch(/^\$2b\$12\$/);
  });

  it('verifyPassword 正确密码返回 true', async () => {
    const password = 'correct-horse-battery';
    const hash = await hashPassword(password);
    expect(await verifyPassword(password, hash)).toBe(true);
  });

  it('verifyPassword 错误密码返回 false', async () => {
    const hash = await hashPassword('correct-password');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });
});
