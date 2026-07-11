import { z } from 'zod';

export const registerSchema = z.object({
  username: z
    .string()
    .min(3, '用户名至少 3 个字符')
    .max(32, '用户名最多 32 个字符')
    .regex(/^[\w\u4e00-\u9fff]+$/, '用户名只允许字母、数字、下划线和中文'),
  password: z.string().min(10, '密码至少 10 个字符').max(72, '密码最多 72 个字符'),
  registrationReason: z.string().max(500).optional(),
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
