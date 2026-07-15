import { z } from 'zod';
import type { WebSourceScope } from './types';

const unsafeEncodedPath = /%(?:2f|5c|2e)/i;

export function normalizeWebSourceUrl(scopeType: WebSourceScope, input: string): string {
  input = input.trim();
  const rawWithoutQuery = input.split(/[?#]/, 1)[0] ?? input;
  const authorityEnd = rawWithoutQuery.indexOf('/', rawWithoutQuery.indexOf('://') + 3);
  const rawPath = authorityEnd === -1 ? '' : rawWithoutQuery.slice(authorityEnd);
  if (unsafeEncodedPath.test(rawPath)) throw new Error('知识源路径包含不安全编码');

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error('URL 格式无效');
  }

  if (parsed.protocol !== 'https:') throw new Error('知识源 URL 必须使用 HTTPS');
  if (parsed.username || parsed.password) throw new Error('知识源 URL 不得包含凭据');
  if (parsed.port) throw new Error('知识源 URL 不得包含端口');
  if (parsed.hostname.endsWith('.')) throw new Error('知识源主机名不得以点结尾');

  parsed.hash = '';
  if (scopeType === 'domain') return parsed.origin;

  if (scopeType === 'path') {
    parsed.search = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.pathname ? `${parsed.origin}${parsed.pathname}` : parsed.origin;
  }

  return `${parsed.origin}${parsed.pathname}${parsed.search}`;
}

const webSourceFields = {
  name: z.string().trim().min(1).max(200),
  scopeType: z.enum(['domain', 'path', 'exact_url']),
  url: z.string().trim().min(1).max(2048),
  sourceLevel: z.enum(['official', 'community']),
  enabled: z.boolean(),
  description: z.string().trim().max(1000).nullable().optional(),
};

const rawWebSourceSchema = z.object({
  ...webSourceFields,
  enabled: webSourceFields.enabled.default(true),
});

export const webSourceInputSchema = rawWebSourceSchema.transform((value, ctx) => {
  try {
    return { ...value, url: normalizeWebSourceUrl(value.scopeType, value.url) };
  } catch (error) {
    ctx.addIssue({
      code: 'custom',
      path: ['url'],
      message: error instanceof Error ? error.message : 'URL 格式无效',
    });
    return z.NEVER;
  }
});

export const webSourceUpdateSchema = z
  .object(webSourceFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: '至少需要提供一个更新字段',
  })
  .transform((value, ctx) => {
    if (value.url === undefined) return value;
    try {
      normalizeWebSourceUrl(value.scopeType ?? 'exact_url', value.url);
      return value;
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: error instanceof Error ? error.message : 'URL 格式无效',
      });
      return z.NEVER;
    }
  });
