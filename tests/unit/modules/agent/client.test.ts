import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
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
const { createChatQuery, createCleaningQuery } = await import(
  '@/modules/agent/client'
);
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
});

// ---------------------------------------------------------------------------
// createCleaningQuery
// ---------------------------------------------------------------------------

describe('createCleaningQuery', () => {
  const sourceText = '# Raw page content\nSome text here with ads and nav bars.';
  const draftId = 'draft-001';

  it('returns an AsyncGenerator', () => {
    const gen = createCleaningQuery(baseConfig, sourceText, draftId);
    expect(gen).toBeDefined();
    expect(typeof gen[Symbol.asyncIterator]).toBe('function');
  });

  it('registers only the knowledge-cleaner agent', () => {
    createCleaningQuery(baseConfig, sourceText, draftId);
    const callArgs = lastCallArgs();
    const agents = callArgs.options.agents;
    expect(Object.keys(agents)).toEqual(['knowledge-cleaner']);
  });

  it('knowledge-cleaner has Agent in disallowedTools', () => {
    createCleaningQuery(baseConfig, sourceText, draftId);
    const callArgs = lastCallArgs();
    const cleaner = callArgs.options.agents['knowledge-cleaner'];
    expect(cleaner.disallowedTools).toContain('Agent');
  });

  it('includes draftId in the prompt', () => {
    createCleaningQuery(baseConfig, sourceText, draftId);
    const callArgs = lastCallArgs();
    expect(callArgs.prompt).toContain(draftId);
  });

  it('does not expose WebSearch or WebFetch to knowledge-cleaner', () => {
    createCleaningQuery(baseConfig, sourceText, draftId);
    const callArgs = lastCallArgs();
    const cleaner = callArgs.options.agents['knowledge-cleaner'];
    expect(cleaner.disallowedTools).toContain('WebSearch');
    expect(cleaner.disallowedTools).toContain('WebFetch');
  });
});
