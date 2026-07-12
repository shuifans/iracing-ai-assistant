import {
  MAX_USERNAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  MIN_USERNAME_LENGTH,
  USERNAME_ALLOWED_DESC,
  USERNAME_REGEX,
} from '@/modules/auth/constants';

export function validateRegisterForm(
  username: string,
  password: string,
  confirmPassword: string,
): string | null {
  if (username.length < MIN_USERNAME_LENGTH) {
    return `用户名至少 ${MIN_USERNAME_LENGTH} 个字符`;
  }
  if (username.length > MAX_USERNAME_LENGTH) {
    return `用户名最多 ${MAX_USERNAME_LENGTH} 个字符`;
  }
  if (!USERNAME_REGEX.test(username)) {
    return `用户名只允许${USERNAME_ALLOWED_DESC}`;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `密码长度不能少于 ${MIN_PASSWORD_LENGTH} 位`;
  }
  if (password !== confirmPassword) {
    return '两次输入的密码不一致';
  }
  return null;
}
