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
import { existsSync } from 'node:fs';
import {
  query,
  accessTokenFromEnv,
  type Options,
  type SDKMessage,
} from '@qoder-ai/qoder-agent-sdk';
import type { AgentDefinition } from '@qoder-ai/qoder-agent-sdk';
import type { ModelPolicyProvider } from '@qoder-ai/qoder-agent-sdk';
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

/**
 * Resolve the qodercli entry point.
 * On Windows the .cmd wrapper causes EINVAL with Node's spawn;
 * point directly to the JS bundle instead.
 */
function resolveCliPath(): string | undefined {
  if (process.platform !== 'win32') return undefined;
  const candidates = [
    path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@qoder-ai', 'qodercli', 'bundle', 'qodercli.js'),
  ];
  return candidates.find(existsSync);
}

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
const preToolUseHook = async (input: any): Promise<any> => {
  const toolName: string = input?.tool_name ?? '';

  // File read tools — enforce wikiRoot boundary
  if (['Read', 'Glob', 'Grep'].includes(toolName)) {
    const toolInput = input?.tool_input ?? {};
    const filePath: string = toolInput.file_path ?? toolInput.path ?? toolInput.pattern ?? '';
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
const postToolUseHook = async (input: any): Promise<any> => {
  const toolOutput: string = input?.tool_output ?? '';
  if (!toolOutput) return {};

  const match = toolOutput.match(/\[[\s\S]*?\]/);
  if (!match) return {};

  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return {};

    const evidence = parsed.filter(
      (e: Record<string, unknown>) => typeof e === 'object' && e !== null && 'evidenceId' in e,
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
      maxTurns: 2,
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
  feedback?: string,
): AsyncGenerator<SDKMessage> {
  const agents: Record<string, AgentDefinition> = {
    'knowledge-cleaner': {
      description: 'Clean raw extracted text into structured Markdown for the Wiki',
      prompt: KNOWLEDGE_CLEANER_PROMPT,
      tools: ['Read', 'Write'],
      disallowedTools: [...DISALLOWED_TOOLS, 'Agent', 'WebSearch', 'WebFetch'],
      maxTurns: 8,
      effort: 'high',
    },
  };

  const cliPath = resolveCliPath();

  const queryOptions: Options = {
    auth: accessTokenFromEnv(),
    cwd: path.resolve(config.wikiRoot, '..'), // data directory, not wiki
    model: config.model,
    maxTurns: 8,
    ...(cliPath ? { pathToQoderCLIExecutable: cliPath } : {}),
    resolveModel: createModelPolicy(config.model),
    disallowedTools: DISALLOWED_TOOLS,
    agents,
    includePartialMessages: false,
    onAuthExpired: () => {
      console.warn('[Agent] AGENT_AUTH_EXPIRED — Qoder PAT auth expired (sanitized)');
    },
  };

  let prompt = `Clean the following raw text (draft ID: ${draftId}) into a well-structured Markdown document:\n\n${sourceText}`;
  // Re-clean path: when reviewer feedback is present (from the evaluation
  // feedback loop), append it so the knowledge-cleaner incorporates the
  // requested adjustments into the new draft.
  if (feedback && feedback.trim()) {
    prompt += `\n\n## Reviewer Feedback (incorporate these requirements into the cleaned output)\n${feedback.trim()}`;
  }
  return query({ prompt, options: queryOptions });
}
