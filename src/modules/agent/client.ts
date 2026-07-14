/**
 * Qoder Agent SDK client factory.
 *
 * Creates configured `query()` sessions for main chat, including the
 * wiki-search and web-research sub-agents.
 *
 * SPEC 10.1–10.3 — PAT auth, agent definitions, tool restrictions, hooks.
 *
 * @module agent/client
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import {
  query,
  accessTokenFromEnv,
  type Options,
  type SDKMessage,
  type HookCallback,
  type PostToolUseHookInput,
} from '@qoder-ai/qoder-agent-sdk';
import type { AgentDefinition } from '@qoder-ai/qoder-agent-sdk';
import type { ModelPolicyProvider } from '@qoder-ai/qoder-agent-sdk';
import { parseEvidenceEnvelope, type ChatQueryOptions, type AgentConfig } from './types';
import {
  CHAT_SYSTEM_PROMPT,
  WIKI_SEARCH_PROMPT,
  WEB_RESEARCH_PROMPT,
  WEB_RESEARCH_MAX_TURNS,
} from './prompts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** SPEC 10.2 — domains the web-research agent is allowed to query */
type WebFetchRule = Readonly<{ hostname: string; pathPrefix?: string }>;

const WEB_FETCH_RULES: readonly WebFetchRule[] = [
  { hostname: 'support.iracing.com' },
  { hostname: 'iracing.com' },
  { hostname: 'forums.iracing.com' },
  { hostname: 'reddit.com', pathPrefix: '/r/iRacing' },
  { hostname: 'hipole.com' },
  { hostname: 'coachdaveacademy.com' },
  { hostname: 'newsroom.porsche.com' },
];

export const WEB_ALLOWLIST: string[] = WEB_FETCH_RULES.map(
  ({ hostname, pathPrefix }) => `${hostname}${pathPrefix ?? ''}`,
);

export const MAX_WEB_SEARCH_QUERY_LENGTH = 500;

/** SPEC 10.3 — tools the main agent and all sub-agents must never invoke */
export const DISALLOWED_TOOLS: string[] = [
  'Write',
  'Edit',
  'Bash',
  'NotebookEdit',
  'EnterWorktree',
  'ExitWorktree',
];

/**
 * Resolve the qodercli entry point.
 * On Windows the .cmd wrapper causes EINVAL with Node's spawn;
 * point directly to the JS bundle instead.
 */
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a URL targets an explicit allowlisted hostname/path.
 * Subdomains, non-default ports, trailing-dot hostnames, non-HTTPS URLs, and
 * ambiguous encoded path separators are rejected.
 */
function isWebFetchAllowlisted(target: unknown): boolean {
  if (typeof target !== 'string' || target.length === 0) return false;

  try {
    const url = new URL(target);
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.port !== ''
    ) {
      return false;
    }

    const rule = WEB_FETCH_RULES.find(({ hostname }) => url.hostname === hostname);
    if (!rule) return false;
    if (!rule.pathPrefix) return true;

    // Do not decode security-sensitive separators/dot segments into a
    // different path than the one we authorize.
    if (/%(?:2f|5c|2e)/i.test(url.pathname)) return false;
    return url.pathname === rule.pathPrefix || url.pathname.startsWith(`${rule.pathPrefix}/`);
  } catch {
    return false;
  }
}

function isWebSearchQueryValid(query: unknown): query is string {
  return (
    typeof query === 'string' &&
    query.trim().length > 0 &&
    query.length <= MAX_WEB_SEARCH_QUERY_LENGTH
  );
}

function isPathContained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * PreToolUse hook — SPEC 10.3:
 * - File tools (Read/Glob/Grep): path must be under wikiRoot
 * - Web tools  (WebFetch/WebSearch): target must match WEB_ALLOWLIST
 */
const preToolUseHook = async (input: any): Promise<any> => {
  const toolName: string = input?.tool_name ?? '';

  // File read tools — enforce wikiRoot boundary
  if (['Read', 'Glob', 'Grep'].includes(toolName)) {
    const toolInput = input?.tool_input ?? {};
    const filePath: unknown =
      toolName === 'Read'
        ? toolInput.file_path
        : toolName === 'Glob'
          ? toolInput.pattern
          : toolInput.path;
    const wikiRoot = path.resolve(input?.cwd ?? '/');

    if (
      (toolName !== 'Grep' && (typeof filePath !== 'string' || filePath.length === 0)) ||
      (filePath !== undefined && typeof filePath !== 'string') ||
      (typeof filePath === 'string' && !isPathContained(wikiRoot, path.resolve(wikiRoot, filePath)))
    ) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'File path is outside wiki root',
        },
      };
    }
  }

  if (toolName === 'WebSearch') {
    const toolInput = input?.tool_input ?? {};
    if (!isWebSearchQueryValid(toolInput.query)) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'Search query must be a non-empty string of at most 500 characters',
        },
      };
    }
  }

  if (toolName === 'WebFetch') {
    const toolInput = input?.tool_input ?? {};
    if (!isWebFetchAllowlisted(toolInput.url)) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'URL is not in the web fetch allowlist',
        },
      };
    }
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
    },
  };
};

/**
 * PostToolUse hook — extracts evidence JSON emitted by sub-agents so the
 * orchestration layer can persist it alongside the chat message.
 */
function evidenceCandidateFromToolResponse(
  toolResponse: PostToolUseHookInput['tool_response'],
): unknown {
  if (typeof toolResponse === 'string') return toolResponse;
  if (!toolResponse || typeof toolResponse !== 'object' || Array.isArray(toolResponse)) {
    return null;
  }

  const response = toolResponse as Record<string, unknown>;
  if ('evidence' in response) return response;
  return response.result;
}

const postToolUseHook: HookCallback = async (hookInput) => {
  if (hookInput.hook_event_name !== 'PostToolUse') return {};
  const input: PostToolUseHookInput = hookInput;
  const evidenceCandidate = evidenceCandidateFromToolResponse(input.tool_response);
  if (!evidenceCandidate) return {};

  const envelope = parseEvidenceEnvelope(evidenceCandidate);
  if (!envelope || envelope.evidence.length === 0) return {};

  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      updatedToolOutput: JSON.stringify(envelope),
    },
  };
};

// ---------------------------------------------------------------------------
// Model policy — enable thinking for the main agent (pull-mode)
// ---------------------------------------------------------------------------

/**
 * Create a resolveModel callback that enables thinking/reasoning.
 * Pull-mode: the SDK asks us before each LLM call which model to use.
 */
function createModelPolicy(model?: string): ModelPolicyProvider {
  return async (_ctx) => ({
    model: model || 'Qwen3.7-Plus',
    parameters: { reasoningEffort: 'high' },
  });
}

// ---------------------------------------------------------------------------
// Sub-agent definitions (SPEC 10.2)
// ---------------------------------------------------------------------------

function chatAgentDefinitions(wikiRoot: string): Record<string, AgentDefinition> {
  return {
    'wiki-search': {
      description: 'Search the local md-wiki and return structured evidence snippets',
      prompt: WIKI_SEARCH_PROMPT,
      tools: ['Read', 'Glob', 'Grep'],
      disallowedTools: [...DISALLOWED_TOOLS, 'Agent'],
      maxTurns: 5,
      effort: 'medium',
    },
    'web-research': {
      description: 'Query allowlisted iRacing websites when the Wiki is insufficient',
      prompt: WEB_RESEARCH_PROMPT,
      tools: ['WebSearch', 'WebFetch'],
      disallowedTools: [...DISALLOWED_TOOLS, 'Agent'],
      maxTurns: WEB_RESEARCH_MAX_TURNS,
      effort: 'medium',
    },
  };
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Create a chat query session with wiki-search and web-research sub-agents.
 *
 * Caller MUST `finally { await q.return(undefined) }` or consume the generator
 * to ensure the SDK session is closed (SPEC 10.1).
 */
export function createChatQuery(
  config: AgentConfig,
  options: ChatQueryOptions,
): AsyncGenerator<SDKMessage> {
  const systemPrompt = CHAT_SYSTEM_PROMPT;

  const cliPath = resolveCliPath();

  const queryOptions: Options = {
    auth: accessTokenFromEnv(),
    cwd: config.wikiRoot,
    model: config.model,
    maxTurns: 6,
    ...(cliPath ? { pathToQoderCLIExecutable: cliPath } : {}),
    resolveModel: createModelPolicy(config.model),
    systemPrompt,
    tools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Agent'],
    allowedTools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Agent'],
    disallowedTools: DISALLOWED_TOOLS,
    agents: chatAgentDefinitions(config.wikiRoot),
    includePartialMessages: true,
    abortController: options.abortController,
    hooks: {
      PreToolUse: [{ hooks: [preToolUseHook] }],
      PostToolUse: [{ hooks: [postToolUseHook] }],
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
