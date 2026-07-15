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

export async function consumeChatEvalSse(
  response: Response,
  onEvent: (eventType: string, data: unknown) => void,
  onFirstChunk?: () => void,
): Promise<void> {
  if (!response.body) throw new Error('chat message response has no SSE body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventType = '';
  let dataLines: string[] = [];
  let terminalComplete = false;
  let postTerminalData = false;
  let receivedChunk = false;

  const dispatch = (): void => {
    if (!eventType && dataLines.length === 0) return;
    if (!eventType || dataLines.length === 0) {
      throw new Error('chat SSE returned an incomplete event');
    }

    let data: unknown;
    try {
      data = JSON.parse(dataLines.join('\n'));
    } catch {
      throw new Error('chat SSE returned malformed JSON');
    }

    if (eventType === 'error') throw new Error('chat SSE reported an error');
    if (eventType === 'done') {
      if (
        !data ||
        typeof data !== 'object' ||
        (data as Record<string, unknown>).status !== 'complete'
      ) {
        throw new Error('chat SSE done event did not report done/complete');
      }
      onEvent(eventType, data);
      terminalComplete = true;
      eventType = '';
      dataLines = [];
      return;
    }

    onEvent(eventType, data);
    eventType = '';
    dataLines = [];
  };

  const consumeLine = (line: string): void => {
    if (line === '') {
      if (terminalComplete && postTerminalData) {
        throw new Error('chat SSE contained data after done/complete');
      }
      dispatch();
      return;
    }
    if (line.startsWith(':')) return;
    if (terminalComplete) {
      postTerminalData = true;
      return;
    }

    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') eventType = value.trim();
    else if (field === 'data') dataLines.push(value);
    else throw new Error('chat SSE returned an unsupported field');
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!receivedChunk) {
      receivedChunk = true;
      onFirstChunk?.();
    }
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const rawLine = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      consumeLine(rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine);
      newline = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();

  if (buffer.trim() || eventType || dataLines.length > 0 || postTerminalData) {
    throw new Error('chat SSE ended with trailing unparsed data');
  }
  if (!terminalComplete) throw new Error('chat SSE ended without done/complete');
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
