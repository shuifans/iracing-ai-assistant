import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PostToolUseHookInput, PreToolUseHookInput } from '@qoder-ai/qoder-agent-sdk';
import { CHAT_SYSTEM_PROMPT } from '@/modules/agent/prompts';
import type { Evidence } from '@/modules/agent/types';
import type { WebSourceRule } from '@/modules/web-sources/types';
import { DISALLOWED_TOOLS } from '@/modules/agent/client';

function makeStubGenerator(): AsyncGenerator<any> {
  let done = false;
  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      if (done) return { value: undefined, done: true };
      done = true;
      return { value: { type: 'result', subtype: 'success' }, done: false };
    },
    async return(value?: any) {
      return { value, done: true };
    },
    async throw(err?: any) {
      throw err;
    },
  } as unknown as AsyncGenerator<any>;
}

vi.mock('@qoder-ai/qoder-agent-sdk', async () => ({
  query: vi.fn(() => makeStubGenerator()),
  accessTokenFromEnv: vi.fn(() => ({
    type: 'accessToken',
    accessToken: { envVar: 'QODER_PERSONAL_ACCESS_TOKEN' },
  })),
}));

const { createChatQuery } = await import('@/modules/agent/client');
const { query: rawQuery } = await import('@qoder-ai/qoder-agent-sdk');
const mockQuery = rawQuery as unknown as Mock;

function lastCallArgs(): any {
  return mockQuery.mock.calls.at(-1)![0] as any;
}

const baseConfig = {
  wikiRoot: '/data/md-wiki',
  pat: 'test-pat-token',
  chatTimeoutMs: 120_000,
  cleanTimeoutMs: 900_000,
};

const rules: WebSourceRule[] = [
  {
    id: 'official',
    name: 'iRacing Support',
    scopeType: 'domain',
    url: 'https://support.iracing.com/',
    hostname: 'support.iracing.com',
    sourceLevel: 'official',
  },
  {
    id: 'reddit',
    name: 'iRacing Reddit',
    scopeType: 'path',
    url: 'https://reddit.com/r/iRacing',
    hostname: 'reddit.com',
    pathPrefix: '/r/iRacing',
    sourceLevel: 'community',
  },
  {
    id: 'article',
    name: 'Setup article',
    scopeType: 'exact_url',
    url: 'https://coachdaveacademy.com/tutorials/iracing-setup-guide/',
    hostname: 'coachdaveacademy.com',
    pathPrefix: '/tutorials/iracing-setup-guide/',
    sourceLevel: 'community',
  },
];

function makeOptions(overrides: Record<string, unknown> = {}) {
  return {
    userMessage: 'How do I trail-brake into Turn 1 at Watkins Glen?',
    abortController: new AbortController(),
    webSearchEnabled: false,
    loadWebSourceRules: vi.fn(() => rules),
    webSourcesSnapshotPath: '/app/notes/knowledge-sources.md',
    onEvidence: vi.fn<(evidence: Evidence) => void>(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DISALLOWED_TOOLS', () => {
  it.each(['Write', 'Edit', 'Bash', 'NotebookEdit', 'EnterWorktree', 'ExitWorktree'])(
    'contains %s',
    (tool) => expect(DISALLOWED_TOOLS).toContain(tool),
  );
});

describe('createChatQuery', () => {
  it('keeps legacy callers local-only with safe defaults', async () => {
    createChatQuery(baseConfig, {
      userMessage: 'How do I brake?',
      abortController: new AbortController(),
    });
    const options = lastCallArgs().options;
    const preToolUse = options.hooks.PreToolUse[0].hooks[0];

    expect(options.tools).toEqual(['Read', 'Glob', 'Grep']);
    await expect(
      preToolUse({
        hook_event_name: 'PreToolUse',
        tool_name: 'WebFetch',
        tool_input: { url: 'https://support.iracing.com/article/1' },
      }),
    ).resolves.toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: 'WEB_TOOLS_DISABLED',
      },
    });
  });

  it('uses Qwen3.7-Plus and direct local tools without sub-agents', async () => {
    createChatQuery(baseConfig, makeOptions());
    const options = lastCallArgs().options;

    await expect(options.resolveModel({})).resolves.toMatchObject({ model: 'Qwen3.7-Plus' });
    expect(options.tools).toEqual(['Read', 'Glob', 'Grep']);
    expect(options.allowedTools).toEqual(['Read', 'Glob', 'Grep']);
    expect(options.agents).toBeUndefined();
    expect(options.allowedTools).not.toContain('Agent');
  });

  it('does not let config.model override the fixed Qwen3.7-Plus model', async () => {
    createChatQuery({ ...baseConfig, model: 'performance' }, makeOptions());

    expect(lastCallArgs().options.model).toBe('Qwen3.7-Plus');
    await expect(lastCallArgs().options.resolveModel({})).resolves.toMatchObject({
      model: 'Qwen3.7-Plus',
    });
  });

  it('adds web tools only when the session enables them', () => {
    createChatQuery(baseConfig, makeOptions({ webSearchEnabled: true }));

    expect(lastCallArgs().options.tools).toEqual(['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch']);
  });

  it('sends the system prompt only when resume is absent', () => {
    createChatQuery(baseConfig, makeOptions());
    expect(lastCallArgs().options.systemPrompt).toContain(CHAT_SYSTEM_PROMPT);
    expect(lastCallArgs().options.systemPrompt).toContain(
      'Read the Web source snapshot only at this exact path: /app/notes/knowledge-sources.md',
    );

    createChatQuery(baseConfig, makeOptions({ qoderSessionId: 'session-1' }));
    expect(lastCallArgs().options.systemPrompt).toBeUndefined();
    expect(lastCallArgs().options.resume).toBe('session-1');
  });

  it('passes the message, cwd, image blocks, and streaming options to the SDK', async () => {
    const generator = createChatQuery(
      baseConfig,
      makeOptions({ imageAttachments: [{ base64: 'aW1hZ2U=', mediaType: 'image/png' }] }),
    );
    const prompt = lastCallArgs().prompt as AsyncIterable<any>;

    expect(typeof generator.next).toBe('function');
    expect(lastCallArgs().options.cwd).toBe(baseConfig.wikiRoot);
    expect(lastCallArgs().options.includePartialMessages).toBe(true);
    await expect(prompt[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      value: {
        message: {
          content: [
            { type: 'text', text: expect.stringContaining('trail-brake') },
            { type: 'image', source: { media_type: 'image/png', data: 'aW1hZ2U=' } },
          ],
        },
      },
    });
  });

  describe('query-local PreToolUse boundaries', () => {
    function getHook(
      overrides: Record<string, unknown> = {},
      config: typeof baseConfig = baseConfig,
    ) {
      const options = makeOptions({ webSearchEnabled: true, ...overrides });
      createChatQuery(config, options);
      return {
        hook: lastCallArgs().options.hooks.PreToolUse[0].hooks[0] as (
          input: PreToolUseHookInput,
        ) => Promise<any>,
        options,
      };
    }

    function input(toolName: string, toolInput: Record<string, unknown>): PreToolUseHookInput {
      return {
        session_id: 'session-1',
        transcript_path: '/tmp/session-1.jsonl',
        cwd: '/attacker-controlled-cwd',
        hook_event_name: 'PreToolUse',
        tool_name: toolName,
        tool_input: toolInput,
        tool_use_id: 'tool-1',
      } as PreToolUseHookInput;
    }

    async function decision(
      hook: (value: PreToolUseHookInput) => Promise<any>,
      value: PreToolUseHookInput,
    ) {
      return (await hook(value)).hookSpecificOutput;
    }

    it('allows wiki reads/searches and the exact snapshot Read only', async () => {
      const { hook } = getHook();

      await expect(
        decision(hook, input('Read', { file_path: 'cars/gt3.md' })),
      ).resolves.toMatchObject({ permissionDecision: 'allow' });
      await expect(decision(hook, input('Glob', { pattern: '**/*.md' }))).resolves.toMatchObject({
        permissionDecision: 'allow',
      });
      await expect(
        decision(hook, input('Grep', { pattern: 'trail braking' })),
      ).resolves.toMatchObject({ permissionDecision: 'allow' });
      await expect(
        decision(hook, input('Read', { file_path: '/app/notes/knowledge-sources.md' })),
      ).resolves.toMatchObject({ permissionDecision: 'allow' });
    });

    it.each([
      ['Read', { file_path: '../private.md' }],
      ['Read', { file_path: '/app/notes/other.md' }],
      ['Glob', { pattern: '/app/notes/**/*.md' }],
      ['Grep', { pattern: 'secret', path: '/app/notes' }],
      ['Grep', { pattern: 'secret', path: 42 }],
    ])('denies %s outside the configured file boundary', async (toolName, toolInput) => {
      const { hook } = getHook();
      await expect(decision(hook, input(toolName, toolInput))).resolves.toMatchObject({
        permissionDecision: 'deny',
      });
    });

    it('validates Glob path as well as its pattern', async () => {
      const { hook } = getHook();

      await expect(
        decision(hook, input('Glob', { pattern: '**/*.md', path: '/app/notes' })),
      ).resolves.toMatchObject({
        permissionDecision: 'deny',
        permissionDecisionReason: 'FILE_TOOL_PATH_NOT_ALLOWED',
      });
    });

    it.each([
      ['Read', (link: string) => ({ file_path: `${link}/secret.md` })],
      ['Glob', (link: string) => ({ pattern: '**/*.md', path: link })],
      ['Glob', (link: string) => ({ pattern: `${link}/**/*.md` })],
      ['Grep', (link: string) => ({ pattern: 'secret', path: link })],
    ])(
      'denies %s access through a Wiki symlink that resolves outside',
      async (toolName, toolInput) => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'qoder-file-boundary-'));
        const wikiRoot = path.join(tempRoot, 'wiki');
        const outsideRoot = path.join(tempRoot, 'outside');
        mkdirSync(wikiRoot);
        mkdirSync(outsideRoot);
        symlinkSync(outsideRoot, path.join(wikiRoot, 'escape'));

        try {
          const config = { ...baseConfig, wikiRoot };
          const { hook } = getHook({}, config);
          await expect(decision(hook, input(toolName, toolInput('escape')))).resolves.toMatchObject(
            {
              permissionDecision: 'deny',
              permissionDecisionReason: 'FILE_TOOL_PATH_NOT_ALLOWED',
            },
          );
        } finally {
          rmSync(tempRoot, { recursive: true, force: true });
        }
      },
    );

    it('allows a nonexistent candidate whose nearest real parent remains in the Wiki', async () => {
      const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'qoder-file-boundary-'));
      const wikiRoot = path.join(tempRoot, 'wiki');
      mkdirSync(wikiRoot);

      try {
        const { hook } = getHook({}, { ...baseConfig, wikiRoot });
        await expect(
          decision(hook, input('Read', { file_path: 'future/note.md' })),
        ).resolves.toMatchObject({ permissionDecision: 'allow' });
        await expect(
          decision(hook, input('Glob', { pattern: 'future/**/*.md' })),
        ).resolves.toMatchObject({ permissionDecision: 'allow' });
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    });

    it('requires authorized site restrictions and path semantics for WebSearch', async () => {
      const { hook } = getHook();

      await expect(
        decision(
          hook,
          input('WebSearch', { query: '(site:example.com) site:support.iracing.com rain' }),
        ),
      ).resolves.toMatchObject({
        permissionDecision: 'deny',
        permissionDecisionReason: 'WEB_SEARCH_SOURCE_NOT_ALLOWED',
      });
      await expect(
        decision(hook, input('WebSearch', { query: 'rain tyres site:support.iracing.com' })),
      ).resolves.toMatchObject({ permissionDecision: 'allow' });
      await expect(
        decision(hook, input('WebSearch', { query: 'rain tyres' })),
      ).resolves.toMatchObject({ permissionDecision: 'deny' });
      await expect(
        decision(hook, input('WebSearch', { query: 'site:example.com iRacing' })),
      ).resolves.toMatchObject({ permissionDecision: 'deny' });
      await expect(
        decision(hook, input('WebSearch', { query: 'site:reddit.com iRacing rain' })),
      ).resolves.toMatchObject({ permissionDecision: 'deny' });
    });

    it('allows a path-scoped site restriction only with its configured path', async () => {
      const { hook } = getHook();
      await expect(
        decision(hook, input('WebSearch', { query: 'site:reddit.com/r/iRacing rain' })),
      ).resolves.toMatchObject({ permissionDecision: 'allow' });
    });

    it('reloads enabled rules for every web call', async () => {
      const loadWebSourceRules = vi
        .fn<() => WebSourceRule[]>()
        .mockReturnValueOnce(rules)
        .mockReturnValueOnce([]);
      const { hook } = getHook({ loadWebSourceRules });

      await expect(
        decision(hook, input('WebFetch', { url: 'https://support.iracing.com/article/1' })),
      ).resolves.toMatchObject({ permissionDecision: 'allow' });
      await expect(
        decision(hook, input('WebFetch', { url: 'https://support.iracing.com/article/2' })),
      ).resolves.toMatchObject({ permissionDecision: 'deny' });
      expect(loadWebSourceRules).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['https://support.iracing.com/article/1', 'allow'],
      ['https://reddit.com/r/iRacing', 'allow'],
      ['https://reddit.com/r/iRacing/comments/1', 'allow'],
      ['https://reddit.com/r/simracing', 'deny'],
      ['https://coachdaveacademy.com/tutorials/iracing-setup-guide/', 'allow'],
      ['https://coachdaveacademy.com/tutorials/iracing-setup-guide/child', 'deny'],
      ['https://sub.support.iracing.com/article/1', 'deny'],
      ['http://support.iracing.com/article/1', 'deny'],
      ['https://reddit.com/r/iRacing%2F..%2Fsimracing', 'deny'],
    ])('validates dynamic WebFetch rule for %s', async (url, expected) => {
      const { hook } = getHook();
      await expect(decision(hook, input('WebFetch', { url }))).resolves.toMatchObject({
        permissionDecision: expected,
      });
    });

    it('does not let invalid calls consume the WebSearch budget', async () => {
      const { hook } = getHook();
      const valid = input('WebSearch', { query: 'rain site:support.iracing.com' });

      await expect(decision(hook, input('WebSearch', { query: 'rain' }))).resolves.toMatchObject({
        permissionDecision: 'deny',
      });
      await expect(decision(hook, valid)).resolves.toMatchObject({ permissionDecision: 'allow' });
      await expect(decision(hook, valid)).resolves.toMatchObject({
        permissionDecision: 'deny',
        permissionDecisionReason: 'WEB_TOOL_BUDGET_EXHAUSTED',
      });
    });

    it('allows two valid WebFetch calls and denies the third per query', async () => {
      const { hook } = getHook();
      const fetch = (suffix: string) =>
        input('WebFetch', { url: `https://support.iracing.com/${suffix}` });

      await expect(decision(hook, fetch('one'))).resolves.toMatchObject({
        permissionDecision: 'allow',
      });
      await expect(decision(hook, fetch('two'))).resolves.toMatchObject({
        permissionDecision: 'allow',
      });
      await expect(decision(hook, fetch('three'))).resolves.toMatchObject({
        permissionDecision: 'deny',
        permissionDecisionReason: 'WEB_TOOL_BUDGET_EXHAUSTED',
      });
    });
  });

  describe('direct-tool PostToolUse evidence', () => {
    function getHook() {
      const options = makeOptions({ webSearchEnabled: true });
      createChatQuery(baseConfig, options);
      return {
        hook: lastCallArgs().options.hooks.PostToolUse[0].hooks[0] as (
          input: PostToolUseHookInput,
        ) => Promise<any>,
        onEvidence: options.onEvidence,
      };
    }

    function input(
      toolName: string,
      toolInput: Record<string, unknown>,
      toolResponse: unknown,
    ): PostToolUseHookInput {
      return {
        session_id: 'session-1',
        transcript_path: '/tmp/session-1.jsonl',
        cwd: baseConfig.wikiRoot,
        hook_event_name: 'PostToolUse',
        tool_name: toolName,
        tool_input: toolInput,
        tool_response: toolResponse,
        tool_use_id: 'tool-1',
      } as PostToolUseHookInput;
    }

    it('records Read evidence without replacing the model-visible tool output', async () => {
      const { hook, onEvidence } = getHook();
      const text = 'Trail braking details '.repeat(50);

      const result = await hook(input('Read', { file_path: 'driving/trail-braking.md' }, text));

      expect(result).toEqual({});
      expect(onEvidence).toHaveBeenCalledOnce();
      expect(onEvidence).toHaveBeenCalledWith(
        expect.objectContaining({
          evidenceId: expect.any(String),
          type: 'wiki',
          title: 'trail-braking.md',
          wikiPath: 'driving/trail-braking.md',
          excerpt: text.slice(0, 600),
          retrievedAt: expect.any(String),
        }),
      );
    });

    it('records canonical WebFetch evidence from an object response', async () => {
      const { hook, onEvidence } = getHook();
      const url = 'https://support.iracing.com/article/123?b=2&a=1';

      const result = await hook(input('WebFetch', { url }, { content: 'Official article body' }));

      expect(result).toEqual({});
      expect(onEvidence).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'web',
          title: 'support.iracing.com',
          url,
          excerpt: 'Official article body',
        }),
      );
    });

    it('rejects evidence when WebFetch redirectUrl is outside the current rules', async () => {
      const { hook, onEvidence } = getHook();

      const result = await hook(
        input(
          'WebFetch',
          { url: 'https://support.iracing.com/article/123' },
          {
            content: 'Untrusted redirect body',
            url: 'https://support.iracing.com/article/123',
            redirectUrl: 'https://example.com/copied',
          },
        ),
      );

      expect(result).toEqual({});
      expect(onEvidence).not.toHaveBeenCalled();
    });

    it('records an authorized WebFetch redirectUrl after a redirect', async () => {
      const { hook, onEvidence } = getHook();
      const finalUrl = 'https://support.iracing.com/article/canonical';

      await hook(
        input(
          'WebFetch',
          { url: 'https://support.iracing.com/article/123' },
          {
            content: 'Canonical body',
            url: 'https://support.iracing.com/article/123',
            redirectUrl: finalUrl,
          },
        ),
      );

      expect(onEvidence).toHaveBeenCalledWith(expect.objectContaining({ url: finalUrl }));
    });

    it('does not record the source snapshot or unrelated tools as answer evidence', async () => {
      const { hook, onEvidence } = getHook();

      await hook(input('Read', { file_path: '/app/notes/knowledge-sources.md' }, 'rules'));
      await hook(input('Grep', { pattern: 'trail' }, 'matches'));

      expect(onEvidence).not.toHaveBeenCalled();
    });
  });
});
