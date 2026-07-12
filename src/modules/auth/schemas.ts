import { z } from 'zod';
import {
  MAX_PASSWORD_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  MIN_USERNAME_LENGTH,
  USERNAME_ALLOWED_DESC,
  USERNAME_REGEX,
} from './constants';

export const registerSchema = z.object({
  username: z
    .string()
    .min(MIN_USERNAME_LENGTH, `用户名至少 ${MIN_USERNAME_LENGTH} 个字符`)
    .max(MAX_USERNAME_LENGTH, `用户名最多 ${MAX_USERNAME_LENGTH} 个字符`)
    .regex(USERNAME_REGEX, `用户名只允许${USERNAME_ALLOWED_DESC}`),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `密码至少 ${MIN_PASSWORD_LENGTH} 个字符`)
    .max(MAX_PASSWORD_LENGTH, `密码最多 ${MAX_PASSWORD_LENGTH} 个字符`),
  registrationReason: z.string().max(500).optional(),
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
