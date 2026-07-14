import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { PostToolUseHookInput } from '@qoder-ai/qoder-agent-sdk';
import { WEB_ALLOWLIST, DISALLOWED_TOOLS } from '@/modules/agent/client';

// ---------------------------------------------------------------------------
// Mock the SDK — we only need `query` to return a stub AsyncGenerator
// ---------------------------------------------------------------------------

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

vi.mock('@qoder-ai/qoder-agent-sdk', async () => {
  return {
    query: vi.fn(() => makeStubGenerator()),
    accessTokenFromEnv: vi.fn(() => ({
      type: 'accessToken',
      accessToken: { envVar: 'QODER_PERSONAL_ACCESS_TOKEN' },
    })),
  };
});

// After mock setup, import the module under test
const { createChatQuery } = await import('@/modules/agent/client');
const { query: rawQuery } = await import('@qoder-ai/qoder-agent-sdk');
const mockQuery = rawQuery as unknown as Mock;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Returns the first arg of the most recent mockQuery call, typed as `any`. */
function lastCallArgs(): any {
  const calls = mockQuery.mock.calls;
  return calls[calls.length - 1]![0] as any;
}

describe('WEB_ALLOWLIST', () => {
  it('contains exactly 7 domains', () => {
    expect(WEB_ALLOWLIST).toHaveLength(7);
  });

  it.each([
    'support.iracing.com',
    'iracing.com',
    'forums.iracing.com',
    'reddit.com/r/iRacing',
    'hipole.com',
    'coachdaveacademy.com',
    'newsroom.porsche.com',
  ])('includes %s', (domain) => {
    expect(WEB_ALLOWLIST).toContain(domain);
  });
});

describe('DISALLOWED_TOOLS', () => {
  it('contains Write', () => {
    expect(DISALLOWED_TOOLS).toContain('Write');
  });

  it('contains Edit', () => {
    expect(DISALLOWED_TOOLS).toContain('Edit');
  });

  it('contains Bash', () => {
    expect(DISALLOWED_TOOLS).toContain('Bash');
  });

  it('contains NotebookEdit', () => {
    expect(DISALLOWED_TOOLS).toContain('NotebookEdit');
  });

  it('contains EnterWorktree and ExitWorktree', () => {
    expect(DISALLOWED_TOOLS).toContain('EnterWorktree');
    expect(DISALLOWED_TOOLS).toContain('ExitWorktree');
  });
});

// ---------------------------------------------------------------------------
// createChatQuery
// ---------------------------------------------------------------------------

const baseConfig = {
  wikiRoot: '/data/md-wiki',
  pat: 'test-pat-token',
  chatTimeoutMs: 120_000,
  cleanTimeoutMs: 900_000,
};

const baseOptions = {
  userMessage: 'How do I trail-brake into Turn 1 at Watkins Glen?',
  abortController: new AbortController(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createChatQuery', () => {
  it('returns an AsyncGenerator', () => {
    const gen = createChatQuery(baseConfig, baseOptions);
    expect(gen).toBeDefined();
    expect(typeof gen[Symbol.asyncIterator]).toBe('function');
    expect(typeof gen.next).toBe('function');
    expect(typeof gen.return).toBe('function');
  });

  it('calls SDK query() with correct cwd', async () => {
    createChatQuery(baseConfig, baseOptions);
    expect(mockQuery).toHaveBeenCalledOnce();
    const callArgs = lastCallArgs();
    expect(callArgs.options.cwd).toBe('/data/md-wiki');
  });

  it('includes Agent in allowedTools for main agent', async () => {
    createChatQuery(baseConfig, baseOptions);
    const callArgs = lastCallArgs();
    expect(callArgs.options.allowedTools).toContain('Agent');
  });

  it('passes user message as prompt', async () => {
    createChatQuery(baseConfig, baseOptions);
    const callArgs = lastCallArgs();
    expect(callArgs.prompt).toBe(baseOptions.userMessage);
  });

  it('passes images as supported base64 image blocks', async () => {
    createChatQuery(baseConfig, {
      ...baseOptions,
      imageAttachments: [{ base64: 'aW1hZ2U=', mediaType: 'image/png' }],
    });

    const prompt = lastCallArgs().prompt as AsyncIterable<any>;
    const iterator = prompt[Symbol.asyncIterator]();
    const first = await iterator.next();

    expect(first.value).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: baseOptions.userMessage },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'aW1hZ2U=',
            },
          },
        ],
      },
      parent_tool_use_id: null,
    });
  });

  it('passes resume when qoderSessionId is provided', async () => {
    createChatQuery(baseConfig, {
      ...baseOptions,
      qoderSessionId: 'sess-abc-123',
    });
    const callArgs = lastCallArgs();
    expect(callArgs.options.resume).toBe('sess-abc-123');
  });

  it('does not set resume when qoderSessionId is absent', async () => {
    createChatQuery(baseConfig, baseOptions);
    const callArgs = lastCallArgs();
    expect(callArgs.options.resume).toBeUndefined();
  });

  it('registers wiki-search and web-research agents', async () => {
    createChatQuery(baseConfig, baseOptions);
    const callArgs = lastCallArgs();
    const agents = callArgs.options.agents;
    expect(agents).toHaveProperty('wiki-search');
    expect(agents).toHaveProperty('web-research');
  });

  it('sub-agents have Agent in disallowedTools (no nested agents)', async () => {
    createChatQuery(baseConfig, baseOptions);
    const callArgs = lastCallArgs();
    const agents = callArgs.options.agents;
    expect(agents['wiki-search'].disallowedTools).toContain('Agent');
    expect(agents['web-research'].disallowedTools).toContain('Agent');
  });

  it('includes includePartialMessages: true', async () => {
    createChatQuery(baseConfig, baseOptions);
    const callArgs = lastCallArgs();
    expect(callArgs.options.includePartialMessages).toBe(true);
  });

  it('registers PreToolUse and PostToolUse hooks', async () => {
    createChatQuery(baseConfig, baseOptions);
    const callArgs = lastCallArgs();
    expect(callArgs.options.hooks).toHaveProperty('PreToolUse');
    expect(callArgs.options.hooks).toHaveProperty('PostToolUse');
  });

  it('sub-agent wiki-search only exposes Read/Glob/Grep', async () => {
    createChatQuery(baseConfig, baseOptions);
    const callArgs = lastCallArgs();
    const wikiTools = callArgs.options.agents['wiki-search'].tools;
    expect(wikiTools).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('sub-agent web-research only exposes WebSearch/WebFetch', async () => {
    createChatQuery(baseConfig, baseOptions);
    const callArgs = lastCallArgs();
    const webTools = callArgs.options.agents['web-research'].tools;
    expect(webTools).toEqual(['WebSearch', 'WebFetch']);
  });

  it('uses the same web-research max-turn value in the prompt and agent definition', () => {
    createChatQuery(baseConfig, baseOptions);
    const webAgent = lastCallArgs().options.agents['web-research'];

    expect(webAgent.maxTurns).toBe(5);
    expect(webAgent.prompt).toContain(`Maximum ${webAgent.maxTurns} turns`);
  });

  describe('PreToolUse boundaries', () => {
    function getHook(): (input: unknown) => Promise<any> {
      createChatQuery(baseConfig, baseOptions);
      return lastCallArgs().options.hooks.PreToolUse[0].hooks[0];
    }

    it('allows a natural-language WebSearch query', async () => {
      const result = await getHook()({
        tool_name: 'WebSearch',
        tool_input: { query: 'iRacing rain tyre strategy at Spa' },
        cwd: baseConfig.wikiRoot,
      });

      expect(result.hookSpecificOutput.permissionDecision).toBe('allow');
    });

    it.each([
      { query: 42, label: 'non-string' },
      { query: '   ', label: 'blank' },
      { query: 'x'.repeat(501), label: 'too long' },
      { query: `${' '.repeat(501)}iRacing`, label: 'too long before trimming' },
    ])('denies a $label WebSearch query', async ({ query }) => {
      const result = await getHook()({
        tool_name: 'WebSearch',
        tool_input: { query },
        cwd: baseConfig.wikiRoot,
      });

      expect(result.hookSpecificOutput.permissionDecision).toBe('deny');
    });

    it('allows an HTTPS WebFetch to an explicit allowlisted hostname', async () => {
      const result = await getHook()({
        tool_name: 'WebFetch',
        tool_input: { url: 'https://support.iracing.com/articles/123' },
        cwd: baseConfig.wikiRoot,
      });

      expect(result.hookSpecificOutput.permissionDecision).toBe('allow');
    });

    it.each([
      'https://example.com/iracing',
      'https://old.reddit.com/r/iRacing',
      'https://reddit.com:444/r/iRacing',
      'https://reddit.com./r/iRacing',
      'https://reddit.com/r/simracing',
      'https://reddit.com/r/iRacingExtra',
      'https://reddit.com/r/iRacing%2F..%2Fsimracing',
      'http://support.iracing.com/articles/123',
    ])('denies a WebFetch outside the explicit hostname/path rules: %s', async (url) => {
      const result = await getHook()({
        tool_name: 'WebFetch',
        tool_input: { url },
        cwd: baseConfig.wikiRoot,
      });

      expect(result.hookSpecificOutput.permissionDecision).toBe('deny');
    });

    it('allows Reddit only at /r/iRacing or below it', async () => {
      const hook = getHook();
      const root = await hook({
        tool_name: 'WebFetch',
        tool_input: { url: 'https://reddit.com/r/iRacing' },
        cwd: baseConfig.wikiRoot,
      });
      const child = await hook({
        tool_name: 'WebFetch',
        tool_input: { url: 'https://reddit.com/r/iRacing/comments/abc' },
        cwd: baseConfig.wikiRoot,
      });

      expect(root.hookSpecificOutput.permissionDecision).toBe('allow');
      expect(child.hookSpecificOutput.permissionDecision).toBe('allow');
    });

    it.each([
      { toolName: 'Read', toolInput: { file_path: '../md-wiki-sibling/private.md' } },
      { toolName: 'Glob', toolInput: { pattern: '../md-wiki-sibling/**/*.md' } },
      { toolName: 'Grep', toolInput: { pattern: 'secret', path: '../md-wiki-sibling' } },
    ])(
      'denies $toolName access to a Wiki prefix sibling or traversal path',
      async ({ toolName, toolInput }) => {
        const result = await getHook()({
          tool_name: toolName,
          tool_input: toolInput,
          cwd: baseConfig.wikiRoot,
        });

        expect(result.hookSpecificOutput.permissionDecision).toBe('deny');
      },
    );

    it.each([
      { toolName: 'Read', toolInput: { file_path: '..notes/private.md' } },
      { toolName: 'Glob', toolInput: { pattern: '..notes/**/*.md' } },
      { toolName: 'Grep', toolInput: { pattern: 'braking', path: '..notes' } },
    ])(
      'allows $toolName access to a root-contained path whose name starts with dots',
      async ({ toolName, toolInput }) => {
        const result = await getHook()({
          tool_name: toolName,
          tool_input: toolInput,
          cwd: baseConfig.wikiRoot,
        });

        expect(result.hookSpecificOutput.permissionDecision).toBe('allow');
      },
    );

    it('denies a malformed non-string Grep path', async () => {
      const result = await getHook()({
        tool_name: 'Grep',
        tool_input: { pattern: 'braking', path: 42 },
        cwd: baseConfig.wikiRoot,
      });

      expect(result.hookSpecificOutput.permissionDecision).toBe('deny');
    });
  });

  describe('PostToolUse evidence contract', () => {
    function getHook(): (input: PostToolUseHookInput) => Promise<any> {
      createChatQuery(baseConfig, baseOptions);
      return lastCallArgs().options.hooks.PostToolUse[0].hooks[0];
    }

    function postToolInput(toolResponse: unknown): PostToolUseHookInput {
      return {
        session_id: 'qoder-session-1',
        transcript_path: '/tmp/qoder-session-1.jsonl',
        cwd: baseConfig.wikiRoot,
        hook_event_name: 'PostToolUse',
        tool_name: 'Agent',
        tool_input: { agent: 'wiki-search', prompt: 'Find trail braking evidence' },
        tool_response: toolResponse,
        tool_use_id: 'tool-use-1',
      };
    }

    const validEvidence = {
      evidenceId: 'wiki-1',
      type: 'wiki',
      title: 'Trail braking',
      wikiPath: 'driving/trail-braking.md',
      excerpt: 'Release brake pressure progressively as steering input increases.',
      retrievedAt: '2026-07-14T00:00:00.000Z',
    };

    it('normalizes a valid string tool_response envelope for the consumer', async () => {
      const envelope = { evidence: [validEvidence] };
      const result = await getHook()(postToolInput(JSON.stringify(envelope)));

      expect(JSON.parse(result.hookSpecificOutput.updatedToolOutput)).toEqual(envelope);
    });

    it('extracts a valid envelope from the Agent tool_response object', async () => {
      const envelope = { evidence: [validEvidence] };
      const result = await getHook()(
        postToolInput({
          result: JSON.stringify(envelope),
          agent: 'wiki-search',
        }),
      );

      expect(JSON.parse(result.hookSpecificOutput.updatedToolOutput)).toEqual(envelope);
    });

    it.each([
      { evidence: [{ ...validEvidence, retrievedAt: undefined }] },
      { evidence: [{ ...validEvidence, excerpt: 'x'.repeat(601) }] },
      {
        evidence: Array.from({ length: 11 }, (_, index) => ({
          ...validEvidence,
          evidenceId: `wiki-${index}`,
        })),
      },
    ])('rejects malformed or oversized evidence', async (envelope) => {
      const result = await getHook()(postToolInput({ result: JSON.stringify(envelope) }));

      expect(result).toEqual({});
    });
  });
});
