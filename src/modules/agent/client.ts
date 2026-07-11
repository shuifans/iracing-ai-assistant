/**
 * Qoder Agent SDK client factory.
 *
 * Creates configured `query()` sessions for:
 * - Main chat (with wiki-search + web-research sub-agents)
 * - Knowledge cleaning (with knowledge-cleaner sub-agent)
 *
 * SPEC 10.1–10.3 — PAT auth, agent definitions, tool restrictions, hooks.
 *
 * @module agent/client
 */

import path from 'node:path';
import {
  query,
  accessTokenFromEnv,
  type Options,
  type SDKMessage,
} from '@qoder-ai/qoder-agent-sdk';
import type { AgentDefinition } from '@qoder-ai/qoder-agent-sdk';
import type { ChatQueryOptions, AgentConfig } from './types';
import {
  CHAT_SYSTEM_PROMPT,
  WIKI_SEARCH_PROMPT,
  WEB_RESEARCH_PROMPT,
  KNOWLEDGE_CLEANER_PROMPT,
} from './prompts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** SPEC 10.2 — domains the web-research agent is allowed to query */
export const WEB_ALLOWLIST: string[] = [
  'support.iracing.com',
  'iracing.com',
  'forums.iracing.com',
  'reddit.com/r/iRacing',
  'hipole.com',
  'coachdaveacademy.com',
  'newsroom.porsche.com',
];

/** SPEC 10.3 — tools the main agent and all sub-agents must never invoke */
export const DISALLOWED_TOOLS: string[] = [
  'Write',
  'Edit',
  'Bash',
  'NotebookEdit',
  'EnterWorktree',
  'ExitWorktree',
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a URL targets an allowlisted domain.
 * Used by the PreToolUse hook to gate WebFetch / WebSearch calls.
 */
function isUrlAllowlisted(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return WEB_ALLOWLIST.some((domain) => {
      const d = domain.toLowerCase();
      return hostname === d || hostname.endsWith(`.${d}`);
    });
  } catch {
    return false;
  }
}

/**
 * PreToolUse hook — SPEC 10.3:
 * - File tools (Read/Glob/Grep): path must be under wikiRoot
 * - Web tools  (WebFetch/WebSearch): target must match WEB_ALLOWLIST
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const preToolUseHook = async (input: any): Promise<any> => {
  const toolName: string = input?.tool_name ?? '';

  // File read tools — enforce wikiRoot boundary
  if (['Read', 'Glob', 'Grep'].includes(toolName)) {
    const toolInput = input?.tool_input ?? {};
    const filePath: string =
      toolInput.file_path ?? toolInput.path ?? toolInput.pattern ?? '';
    const wikiRoot = path.resolve(input?.cwd ?? '/');

    if (filePath && !path.resolve(wikiRoot, filePath).startsWith(wikiRoot)) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `File path "${filePath}" is outside wiki root`,
        },
      };
    }
  }

  // Web tools — enforce domain allowlist
  if (['WebFetch', 'WebSearch'].includes(toolName)) {
    const toolInput = input?.tool_input ?? {};
    const target: string = toolInput.url ?? toolInput.query ?? '';
    if (target && !isUrlAllowlisted(target)) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `Target "${target}" is not in the web allowlist`,
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postToolUseHook = async (input: any): Promise<any> => {
  const toolOutput: string = input?.tool_output ?? '';
  if (!toolOutput) return {};

  const match = toolOutput.match(/\[[\s\S]*?\]/);
  if (!match) return {};

  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return {};

    const evidence = parsed.filter(
      (e: Record<string, unknown>) =>
        typeof e === 'object' && e !== null && 'evidenceId' in e,
    );
    if (evidence.length === 0) return {};

    return {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        updatedToolOutput: JSON.stringify({ evidence }),
      },
    };
  } catch {
    return {};
  }
};

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
      maxTurns: 5,
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
  const systemPrompt = CHAT_SYSTEM_PROMPT.replace(
    '{{HISTORY_CONTEXT}}',
    options.historyContext ?? '',
  );

  const queryOptions: Options = {
    auth: accessTokenFromEnv(),
    cwd: config.wikiRoot,
    model: config.model,
    maxTurns: 15,
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

  return query({ prompt: options.userMessage, options: queryOptions });
}

/**
 * Create a knowledge-cleaning query session (Work Package D).
 *
 * Only the knowledge-cleaner sub-agent is registered. No web tools are exposed.
 * The working directory is set to the data directory (not the wiki).
 */
export function createCleaningQuery(
  config: AgentConfig,
  sourceText: string,
  draftId: string,
): AsyncGenerator<SDKMessage> {
  const agents: Record<string, AgentDefinition> = {
    'knowledge-cleaner': {
      description: 'Clean raw extracted text into structured Markdown for the Wiki',
      prompt: KNOWLEDGE_CLEANER_PROMPT,
      tools: ['Read', 'Write'],
      disallowedTools: [
        ...DISALLOWED_TOOLS,
        'Agent',
        'WebSearch',
        'WebFetch',
      ],
      maxTurns: 8,
      effort: 'high',
    },
  };

  const queryOptions: Options = {
    auth: accessTokenFromEnv(),
    cwd: path.resolve(config.wikiRoot, '..'), // data directory, not wiki
    model: config.model,
    maxTurns: 8,
    disallowedTools: DISALLOWED_TOOLS,
    agents,
    includePartialMessages: false,
    onAuthExpired: () => {
      console.warn('[Agent] AGENT_AUTH_EXPIRED — Qoder PAT auth expired (sanitized)');
    },
  };

  const prompt = `Clean the following raw text (draft ID: ${draftId}) into a well-structured Markdown document:\n\n${sourceText}`;
  return query({ prompt, options: queryOptions });
}
