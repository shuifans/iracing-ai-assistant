/** Qoder Agent SDK client factory for the single direct-tool chat agent. */

import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import {
  query,
  accessTokenFromEnv,
  type HookCallback,
  type ModelPolicyProvider,
  type Options,
  type PostToolUseHookInput,
  type SDKMessage,
} from '@qoder-ai/qoder-agent-sdk';
import { utcNow } from '@/lib/datetime';
import type { WebSourceRule } from '@/modules/web-sources/types';
import { CHAT_SYSTEM_PROMPT } from './prompts';
import type { AgentConfig, AllowedToolUse, ChatQueryOptions, Evidence } from './types';

type RuntimeChatQueryOptions = ChatQueryOptions & {
  webSearchEnabled: boolean;
  loadWebSourceRules: () => WebSourceRule[];
  webSourcesSnapshotPath: string;
};

export const MAX_WEB_SEARCH_QUERY_LENGTH = 500;
export const WEB_SEARCH_BUDGET = 1;
export const WEB_FETCH_BUDGET = 2;

export const DISALLOWED_TOOLS: string[] = [
  'Write',
  'Edit',
  'Bash',
  'NotebookEdit',
  'EnterWorktree',
  'ExitWorktree',
  'Agent',
];

function resolveCliPath(): string | undefined {
  if (process.platform !== 'win32') return undefined;
  const candidates = [
    path.join(
      process.env.APPDATA ?? '',
      'npm',
      'node_modules',
      '@qoder-ai',
      'qodercli',
      'bundle',
      'qodercli.js',
    ),
  ];
  return candidates.find(existsSync);
}

function isPathContained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function realpathOfExistingAncestor(target: string): string | null {
  let candidate = target;

  while (true) {
    try {
      return realpathSync(candidate);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return null;

      try {
        if (lstatSync(candidate).isSymbolicLink()) return null;
      } catch {
        // The candidate does not exist; its nearest existing parent decides.
      }

      const parent = path.dirname(candidate);
      if (parent === candidate) return null;
      candidate = parent;
    }
  }
}

function isRealPathContained(root: string, target: string): boolean {
  if (!isPathContained(root, target)) return false;

  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    // Transitional/test callers may point at a Wiki not created yet. Lexical
    // containment is the only available boundary until the root exists.
    return true;
  }

  const realTargetOrParent = realpathOfExistingAncestor(target);
  return Boolean(realTargetOrParent && isPathContained(realRoot, realTargetOrParent));
}

function hasParentTraversalSegment(candidate: string): boolean {
  return candidate.split(/[\\/]/).includes('..');
}

function deny(reason: string) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse' as const,
      permissionDecision: 'deny' as const,
      permissionDecisionReason: reason,
    },
  };
}

function allow() {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse' as const,
      permissionDecision: 'allow' as const,
    },
  };
}

function isFileToolAllowed(
  toolName: string,
  toolInput: Record<string, unknown>,
  wikiRoot: string,
  snapshotPath: string,
): boolean {
  if (toolName === 'Read') {
    const candidate = toolInput.file_path;
    if (
      typeof candidate !== 'string' ||
      candidate.length === 0 ||
      hasParentTraversalSegment(candidate)
    ) {
      return false;
    }
    const resolved = path.resolve(wikiRoot, candidate);
    return resolved === snapshotPath || isRealPathContained(wikiRoot, resolved);
  }

  if (toolName === 'Grep') {
    const candidate = toolInput.path;
    if (candidate === undefined) return true;
    if (
      typeof candidate !== 'string' ||
      candidate.length === 0 ||
      hasParentTraversalSegment(candidate)
    ) {
      return false;
    }
    return isRealPathContained(wikiRoot, path.resolve(wikiRoot, candidate));
  }

  const pattern = toolInput.pattern;
  const baseInput = toolInput.path;
  if (
    typeof pattern !== 'string' ||
    pattern.length === 0 ||
    (baseInput !== undefined && (typeof baseInput !== 'string' || baseInput.length === 0)) ||
    hasParentTraversalSegment(pattern) ||
    (typeof baseInput === 'string' && hasParentTraversalSegment(baseInput))
  ) {
    return false;
  }

  const basePath = path.resolve(wikiRoot, (baseInput as string | undefined) ?? '.');
  if (!isRealPathContained(wikiRoot, basePath)) return false;

  const firstGlobCharacter = pattern.search(/[*?[{(]/);
  const staticPrefix = firstGlobCharacter === -1 ? pattern : pattern.slice(0, firstGlobCharacter);
  const patternAnchor = path.resolve(basePath, staticPrefix || '.');
  return isRealPathContained(wikiRoot, patternAnchor);
}

function containsUnsafeUrlSyntax(raw: string): boolean {
  if (/%(?:2f|5c|2e)/i.test(raw)) return true;
  const authority = raw.match(/^https:\/\/([^/?#]*)/i)?.[1] ?? '';
  if (/:[0-9]+$/.test(authority)) return true;
  const rawPath = raw.slice(`https://${authority}`.length).split(/[?#]/, 1)[0] ?? '';
  return rawPath.split('/').some((segment) => segment === '.' || segment === '..');
}

function parseSecureHttpsUrl(target: unknown): URL | null {
  if (typeof target !== 'string' || target.length === 0 || containsUnsafeUrlSyntax(target)) {
    return null;
  }

  try {
    const url = new URL(target);
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.port !== '' ||
      url.hostname.endsWith('.')
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function pathMatchesPrefix(pathname: string, pathPrefix: string): boolean {
  const prefix = pathPrefix === '/' ? '/' : pathPrefix.replace(/\/$/, '');
  return prefix === '/' || pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function matchingWebFetchRule(target: unknown, rules: WebSourceRule[]): WebSourceRule | null {
  const url = parseSecureHttpsUrl(target);
  if (!url) return null;

  return (
    rules.find((rule) => {
      if (url.hostname !== rule.hostname) return false;
      if (rule.scopeType === 'domain') return true;
      if (rule.scopeType === 'path') {
        return Boolean(rule.pathPrefix && pathMatchesPrefix(url.pathname, rule.pathPrefix));
      }
      try {
        return url.href === new URL(rule.url).href;
      } catch {
        return false;
      }
    }) ?? null
  );
}

function authorizedSearchSite(site: string, rules: WebSourceRule[]): boolean {
  const normalized = site.toLowerCase().replace(/\/$/, '');
  return rules.some((rule) => {
    if (rule.scopeType === 'exact_url') return false;
    if (rule.scopeType === 'domain') return normalized === rule.hostname.toLowerCase();
    const prefix = rule.pathPrefix?.replace(/\/$/, '') ?? '';
    return normalized === `${rule.hostname}${prefix}`.toLowerCase();
  });
}

function matchingSearchRules(query: string, rules: WebSourceRule[]): WebSourceRule[] {
  const sites = [...query.matchAll(/\bsite:([^\s]+)/gi)].map((match) => match[1]!);
  return rules.filter((rule) =>
    sites.some((site) => {
      const normalized = site.toLowerCase().replace(/\/$/, '');
      if (rule.scopeType === 'exact_url') return false;
      if (rule.scopeType === 'domain') return normalized === rule.hostname.toLowerCase();
      const prefix = rule.pathPrefix?.replace(/\/$/, '') ?? '';
      return normalized === `${rule.hostname}${prefix}`.toLowerCase();
    }),
  );
}

async function reportAllowedTool(
  options: RuntimeChatQueryOptions,
  input: { tool_use_id?: string; tool_name: string },
  extras: Omit<AllowedToolUse, 'toolUseId' | 'name'> = {},
): Promise<void> {
  if (!options.onAllowedToolUse) return;
  await options.onAllowedToolUse({
    toolUseId: input.tool_use_id ?? randomUUID(),
    name: input.tool_name,
    ...extras,
  });
}

function isWebSearchAllowed(query: unknown, rules: WebSourceRule[]): boolean {
  if (
    typeof query !== 'string' ||
    query.trim().length === 0 ||
    query.length > MAX_WEB_SEARCH_QUERY_LENGTH
  ) {
    return false;
  }
  const sites = [...query.matchAll(/\bsite:([^\s]+)/gi)].map((match) => match[1]!);
  return sites.length > 0 && sites.every((site) => authorizedSearchSite(site, rules));
}

function extractToolText(response: unknown): string {
  if (typeof response === 'string') return response;
  if (!response || typeof response !== 'object') return '';
  const value = response as Record<string, unknown>;
  for (const key of ['content', 'result', 'text']) {
    const candidate = value[key];
    if (typeof candidate === 'string') return candidate;
    if (Array.isArray(candidate)) {
      return candidate
        .map((item) => {
          if (typeof item === 'string') return item;
          if (
            item &&
            typeof item === 'object' &&
            typeof (item as { text?: unknown }).text === 'string'
          ) {
            return (item as { text: string }).text;
          }
          return '';
        })
        .join('');
    }
  }
  return '';
}

function finalWebFetchUrl(response: unknown): unknown {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return undefined;
  const value = response as Record<string, unknown>;
  return value.redirectUrl ?? value.url;
}

function createPreToolUseHook(config: AgentConfig, options: RuntimeChatQueryOptions): HookCallback {
  const wikiRoot = path.resolve(config.wikiRoot);
  const snapshotPath = path.resolve(options.webSourcesSnapshotPath);
  const budget = { webSearch: 0, webFetch: 0 };
  const allowedToolUseIds = new Map<string, string>();

  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const toolName = input.tool_name;
    const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
    const toolUseId = input.tool_use_id;
    const fingerprint = JSON.stringify([toolName, toolInput]);
    if (toolUseId && allowedToolUseIds.has(toolUseId)) {
      return allowedToolUseIds.get(toolUseId) === fingerprint
        ? allow()
        : deny('TOOL_USE_ID_INPUT_MISMATCH');
    }

    const markAllowed = () => {
      if (toolUseId) allowedToolUseIds.set(toolUseId, fingerprint);
    };

    if (toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep') {
      if (!isFileToolAllowed(toolName, toolInput, wikiRoot, snapshotPath)) {
        return deny('FILE_TOOL_PATH_NOT_ALLOWED');
      }
      markAllowed();
      await reportAllowedTool(options, input, {});
      return allow();
    }

    if (toolName === 'WebSearch') {
      if (!options.webSearchEnabled) return deny('WEB_TOOLS_DISABLED');
      const rules = options.loadWebSourceRules();
      if (!isWebSearchAllowed(toolInput.query, rules)) return deny('WEB_SEARCH_SOURCE_NOT_ALLOWED');
      if (budget.webSearch >= WEB_SEARCH_BUDGET) return deny('WEB_TOOL_BUDGET_EXHAUSTED');
      budget.webSearch += 1;
      const sourceName = matchingSearchRules(toolInput.query as string, rules)
        .map((rule) => rule.name)
        .filter((name, index, names) => names.indexOf(name) === index)
        .join('、');
      markAllowed();
      await reportAllowedTool(options, input, {
        current: budget.webSearch,
        limit: WEB_SEARCH_BUDGET,
        ...(sourceName ? { sourceName } : {}),
      });
      return allow();
    }

    if (toolName === 'WebFetch') {
      if (!options.webSearchEnabled) return deny('WEB_TOOLS_DISABLED');
      const rules = options.loadWebSourceRules();
      const matchingRule = matchingWebFetchRule(toolInput.url, rules);
      if (!matchingRule) return deny('WEB_FETCH_SOURCE_NOT_ALLOWED');
      if (budget.webFetch >= WEB_FETCH_BUDGET) return deny('WEB_TOOL_BUDGET_EXHAUSTED');
      budget.webFetch += 1;
      markAllowed();
      await reportAllowedTool(options, input, {
        current: budget.webFetch,
        limit: WEB_FETCH_BUDGET,
        sourceName: matchingRule.name,
      });
      return allow();
    }

    return allow();
  };
}

function createPostToolUseHook(
  config: AgentConfig,
  options: RuntimeChatQueryOptions,
): HookCallback {
  const wikiRoot = path.resolve(config.wikiRoot);
  const snapshotPath = path.resolve(options.webSourcesSnapshotPath);

  return async (hookInput) => {
    if (hookInput.hook_event_name !== 'PostToolUse' || !options.onEvidence) return {};
    const input: PostToolUseHookInput = hookInput;
    const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
    let evidence: Evidence | null = null;

    if (
      input.tool_name === 'Read' &&
      typeof toolInput.file_path === 'string' &&
      isFileToolAllowed('Read', toolInput, wikiRoot, snapshotPath)
    ) {
      const absolutePath = path.resolve(wikiRoot, toolInput.file_path);
      if (absolutePath !== snapshotPath) {
        const wikiPath = path.relative(wikiRoot, absolutePath).split(path.sep).join('/');
        evidence = {
          evidenceId: randomUUID(),
          type: 'wiki',
          title: path.basename(absolutePath),
          wikiPath,
          excerpt: extractToolText(input.tool_response).slice(0, 600),
          retrievedAt: utcNow(),
        };
      }
    }

    if (input.tool_name === 'WebFetch') {
      const responseUrl = finalWebFetchUrl(input.tool_response);
      const canonicalUrl = parseSecureHttpsUrl(responseUrl ?? toolInput.url)?.href;
      if (canonicalUrl && matchingWebFetchRule(canonicalUrl, options.loadWebSourceRules())) {
        evidence = {
          evidenceId: randomUUID(),
          type: 'web',
          title: new URL(canonicalUrl).hostname,
          url: canonicalUrl,
          excerpt: extractToolText(input.tool_response).slice(0, 600),
          retrievedAt: utcNow(),
        };
      }
    }

    if (evidence) await options.onEvidence(evidence);
    return {};
  };
}

function createModelPolicy(): ModelPolicyProvider {
  return async () => ({
    model: 'Qwen3.7-Plus',
    parameters: { reasoningEffort: 'high' },
  });
}

export function createChatQuery(
  config: AgentConfig,
  options: ChatQueryOptions,
): AsyncGenerator<SDKMessage> {
  const cliPath = resolveCliPath();
  const runtimeOptions: RuntimeChatQueryOptions = {
    ...options,
    webSearchEnabled: options.webSearchEnabled ?? false,
    loadWebSourceRules: options.loadWebSourceRules ?? (() => []),
    webSourcesSnapshotPath:
      options.webSourcesSnapshotPath ?? path.join(config.wikiRoot, '.web-sources-disabled'),
  };
  const tools = [
    'Read',
    'Glob',
    'Grep',
    ...(runtimeOptions.webSearchEnabled ? ['WebSearch', 'WebFetch'] : []),
  ];
  const queryOptions: Options = {
    auth: accessTokenFromEnv(),
    cwd: config.wikiRoot,
    model: 'Qwen3.7-Plus',
    maxTurns: 6,
    ...(cliPath ? { pathToQoderCLIExecutable: cliPath } : {}),
    resolveModel: createModelPolicy(),
    ...(!options.qoderSessionId
      ? {
          systemPrompt: `${CHAT_SYSTEM_PROMPT}\n\nRead the Web source snapshot only at this exact path: ${runtimeOptions.webSourcesSnapshotPath}`,
        }
      : {}),
    tools,
    allowedTools: tools,
    disallowedTools: DISALLOWED_TOOLS,
    includePartialMessages: true,
    abortController: options.abortController,
    hooks: {
      PreToolUse: [{ hooks: [createPreToolUseHook(config, runtimeOptions)] }],
      PostToolUse: [{ hooks: [createPostToolUseHook(config, runtimeOptions)] }],
    },
    onAuthExpired: () => {
      console.warn('[Agent] AGENT_AUTH_EXPIRED — Qoder PAT auth expired (sanitized)');
    },
    ...(options.qoderSessionId ? { resume: options.qoderSessionId } : {}),
  };

  if (!options.imageAttachments?.length) {
    return query({ prompt: options.userMessage, options: queryOptions });
  }

  async function* promptWithImages() {
    yield {
      type: 'user' as const,
      message: {
        role: 'user' as const,
        content: [
          { type: 'text', text: options.userMessage },
          ...options.imageAttachments!.map((image) => ({
            type: 'image',
            source: {
              type: 'base64',
              media_type: image.mediaType,
              data: image.base64,
            },
          })),
        ],
      },
      parent_tool_use_id: null,
    };
  }

  return query({ prompt: promptWithImages(), options: queryOptions });
}
