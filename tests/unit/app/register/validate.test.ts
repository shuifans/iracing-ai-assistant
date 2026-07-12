import { describe, it, expect } from 'vitest';
import {
  MAX_USERNAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  MIN_USERNAME_LENGTH,
  USERNAME_ALLOWED_DESC,
} from '@/modules/auth/constants';
import { validateRegisterForm } from '@/app/(public)/register/validation';

const VALID_USER = 'testuser'; // 长度 8，符合正则
const VALID_PASS = 'a'.repeat(MIN_PASSWORD_LENGTH); // 长度 10，边界合法

describe('validateRegisterForm', () => {
  // 3a. 用户名长度不足（分支1）
  it.each([
    { label: '空字符串', username: '', expected: `用户名至少 ${MIN_USERNAME_LENGTH} 个字符` },
    {
      label: '比最小长度少1',
      username: 'a'.repeat(MIN_USERNAME_LENGTH - 1),
      expected: `用户名至少 ${MIN_USERNAME_LENGTH} 个字符`,
    },
  ])('用户名长度不足：$label', ({ username, expected }) => {
    expect(validateRegisterForm(username, VALID_PASS, VALID_PASS)).toBe(expected);
  });

  // 3b. 用户名长度超限（分支2）
  it.each([
    {
      label: '比最大长度多1',
      username: 'a'.repeat(MAX_USERNAME_LENGTH + 1),
      expected: `用户名最多 ${MAX_USERNAME_LENGTH} 个字符`,
    },
    {
      label: '远超最大长度',
      username: 'a'.repeat(100),
      expected: `用户名最多 ${MAX_USERNAME_LENGTH} 个字符`,
    },
  ])('用户名长度超限：$label', ({ username, expected }) => {
    expect(validateRegisterForm(username, VALID_PASS, VALID_PASS)).toBe(expected);
  });

  // 3c. 用户名含非法字符（分支3，长度需在 3-32 内但正则不通过）
  it.each([
    { label: '包含@符号', username: 'a@b', expected: `用户名只允许${USERNAME_ALLOWED_DESC}` },
    { label: '包含空格', username: 'user name', expected: `用户名只允许${USERNAME_ALLOWED_DESC}` },
  ])('用户名含非法字符：$label', ({ username, expected }) => {
    expect(validateRegisterForm(username, VALID_PASS, VALID_PASS)).toBe(expected);
  });

  // 3d. 密码长度不足（分支4）
  it.each([
    {
      label: '比最小长度少1',
      password: 'a'.repeat(MIN_PASSWORD_LENGTH - 1),
      expected: `密码长度不能少于 ${MIN_PASSWORD_LENGTH} 位`,
    },
    { label: '空字符串', password: '', expected: `密码长度不能少于 ${MIN_PASSWORD_LENGTH} 位` },
  ])('密码长度不足：$label', ({ password, expected }) => {
    expect(validateRegisterForm(VALID_USER, password, password)).toBe(expected);
  });

  // 3e. 两次密码不一致（分支5）
  it.each([
    {
      label: '确认密码多一个字符',
      password: VALID_PASS,
      confirmPassword: VALID_PASS + 'x',
      expected: '两次输入的密码不一致',
    },
    {
      label: '完全不同的密码',
      password: 'a'.repeat(MIN_PASSWORD_LENGTH),
      confirmPassword: 'b'.repeat(MIN_PASSWORD_LENGTH),
      expected: '两次输入的密码不一致',
    },
  ])('两次密码不一致：$label', ({ password, confirmPassword, expected }) => {
    expect(validateRegisterForm(VALID_USER, password, confirmPassword)).toBe(expected);
  });

  // 3f. 校验通过（返回 null）
  it.each([
    { label: '常规合法输入', username: VALID_USER, password: VALID_PASS, confirmPassword: VALID_PASS },
    {
      label: '用户名边界 3',
      username: 'a'.repeat(MIN_USERNAME_LENGTH),
      password: VALID_PASS,
      confirmPassword: VALID_PASS,
    },
    {
      label: '用户名边界 32',
      username: 'a'.repeat(MAX_USERNAME_LENGTH),
      password: VALID_PASS,
      confirmPassword: VALID_PASS,
    },
    {
      label: '中文用户名，长度 3',
      username: '赛车手',
      password: VALID_PASS,
      confirmPassword: VALID_PASS,
    },
    {
      label: '含下划线，密码边界 10',
      username: 'user_123',
      password: 'a'.repeat(MIN_PASSWORD_LENGTH),
      confirmPassword: 'a'.repeat(MIN_PASSWORD_LENGTH),
    },
  ])('校验通过：$label', ({ username, password, confirmPassword }) => {
    expect(validateRegisterForm(username, password, confirmPassword)).toBeNull();
  });

  // 3g. 校验顺序（短路）
  it('分支1 先于分支4/5：空用户名 + 短密码 + 不一致', () => {
    expect(validateRegisterForm('', 'short', 'different')).toBe(
      `用户名至少 ${MIN_USERNAME_LENGTH} 个字符`,
    );
  });

  it('分支4 先于分支5：合法用户名 + 短密码 + 不一致', () => {
    expect(validateRegisterForm(VALID_USER, 'short', 'different')).toBe(
      `密码长度不能少于 ${MIN_PASSWORD_LENGTH} 位`,
    );
  });

  it('分支3 先于分支4：非法用户名 + 短密码但一致', () => {
    expect(validateRegisterForm('a@b', 'short', 'short')).toBe(
      `用户名只允许${USERNAME_ALLOWED_DESC}`,
    );
  });

  it('分支1 先于分支3：过短且含非法字符的用户名', () => {
    expect(validateRegisterForm('@', VALID_PASS, VALID_PASS)).toBe(
      `用户名至少 ${MIN_USERNAME_LENGTH} 个字符`,
    );
  });

  it('分支2 先于分支3/4/5：超长且含非法字符的用户名', () => {
    expect(
      validateRegisterForm('a'.repeat(MAX_USERNAME_LENGTH + 1) + '@', 'short', 'diff'),
    ).toBe(`用户名最多 ${MAX_USERNAME_LENGTH} 个字符`);
  });
});
