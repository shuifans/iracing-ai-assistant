import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import {
  createWebSource,
  deleteWebSource,
  listEnabledWebSourceRules,
  listWebSources,
} from '@/modules/web-sources/service';
import { updateSessionWebSearch } from '@/modules/chat/repository';
import type { WebSourceRule } from '@/modules/web-sources/types';

export const EVAL_OFFICIAL_WEB_SOURCE = {
  name: 'iRacing Support (eval)',
  scopeType: 'domain' as const,
  url: 'https://support.iracing.com/',
  sourceLevel: 'official' as const,
  enabled: true,
  description: 'Isolated chat evaluation fixture for official iRacing support content.',
};

export interface EvalWebKnowledgeFixture {
  rules: WebSourceRule[];
  snapshotPath: string;
}

export function requireEvalAdminToken(env: Record<string, string | undefined>): string {
  const token = env.EVAL_ADMIN_TOKEN?.trim();
  if (!token) {
    throw new Error('HTTP eval requires EVAL_ADMIN_TOKEN for a real knowledge administrator');
  }
  return token;
}

export async function ensureHttpWebKnowledgeFixture(
  baseUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const root = new URL(baseUrl);
  const origin = root.origin;
  const collectionUrl = new URL('/api/knowledge/web-sources', root).href;
  const headers = { Authorization: `Bearer ${token}`, Origin: origin };

  const parseResponse = async (response: Response, operation: string): Promise<any> => {
    if (!response.ok) throw new Error(`${operation} failed with HTTP ${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new Error(`${operation} returned malformed JSON`);
    }
  };
  const isExpectedSource = (source: unknown, enabled?: boolean): boolean => {
    if (!source || typeof source !== 'object') return false;
    const value = source as Record<string, unknown>;
    return (
      value.url === EVAL_OFFICIAL_WEB_SOURCE.url &&
      value.scopeType === EVAL_OFFICIAL_WEB_SOURCE.scopeType &&
      (enabled === undefined || value.enabled === enabled)
    );
  };

  const listPayload = await parseResponse(
    await fetchImpl(collectionUrl, { headers }),
    'Web source list',
  );
  const sources = listPayload?.data?.sources;
  if (!Array.isArray(sources)) throw new Error('Web source list returned invalid fixture JSON');
  const existing = sources.find((source) => isExpectedSource(source));
  if (existing && typeof existing === 'object') {
    const value = existing as Record<string, unknown>;
    if (value.enabled === true) return;
    if (value.enabled !== false || typeof value.id !== 'string' || value.id.length === 0) {
      throw new Error('Web source list returned an invalid official fixture');
    }
    const response = await fetchImpl(new URL(`/api/knowledge/web-sources/${value.id}`, root).href, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    const payload = await parseResponse(response, 'Web source enable');
    if (!isExpectedSource(payload?.data?.source, true)) {
      throw new Error('Web source enable returned an invalid fixture');
    }
    return;
  }

  const response = await fetchImpl(collectionUrl, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(EVAL_OFFICIAL_WEB_SOURCE),
  });
  const payload = await parseResponse(response, 'Web source create');
  if (!isExpectedSource(payload?.data?.source, true)) {
    throw new Error('Web source create returned an invalid fixture');
  }
}

export function isNetworkUnavailableError(error: unknown): boolean {
  const unavailableCodes = new Set([
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
  ]);
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const value = current as { code?: unknown; cause?: unknown };
    if (typeof value.code === 'string' && unavailableCodes.has(value.code)) return true;
    current = value.cause;
  }
  return false;
}

export function isHttpEvalRequired(argv: string[], mode: 'direct' | 'http' | 'both'): boolean {
  if (mode === 'direct') return false;
  if (mode === 'http') return true;
  return argv.includes('--mode') || argv.includes('--http-url');
}

export function shouldSkipHttpEvalFailure(error: unknown, required: boolean): boolean {
  return !required && isNetworkUnavailableError(error);
}

export function ensureEvalWebKnowledgeFixture(actorId: string): EvalWebKnowledgeFixture {
  for (const source of listWebSources()) deleteWebSource(source.id, actorId);
  createWebSource(EVAL_OFFICIAL_WEB_SOURCE, actorId);

  const rules = listEnabledWebSourceRules();
  if (
    rules.length !== 1 ||
    rules[0]?.hostname !== 'support.iracing.com' ||
    rules[0]?.scopeType !== 'domain'
  ) {
    throw new Error(
      'eval Web source fixture must contain only the official iRacing support domain',
    );
  }

  const snapshotPath =
    process.env.WEB_KNOWLEDGE_SOURCES_SNAPSHOT_PATH ??
    join(process.cwd(), 'notes', 'knowledge-sources.md');
  accessSync(snapshotPath, constants.R_OK);
  return { rules, snapshotPath };
}

export function setEvalSessionWebState(
  sessionId: string,
  userId: string,
  category: string,
): boolean {
  const enabled = category === 'A2';
  const session = updateSessionWebSearch(sessionId, userId, enabled);
  if (!session) throw new Error('eval session is missing or not owned by the eval user');
  return session.webSearchEnabled;
}
