import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { cleanWithLlmDirect, buildCleanerSystemPrompt, StopCleaningError } from '@/modules/knowledge/llm-cleaner';

// ---------------------------------------------------------------------------
// global.fetch mock
// ---------------------------------------------------------------------------

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function okResponse(content: string) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
  };
}

function errResponse(status: number, body: string) {
  return { ok: false, status, text: async () => body };
}

// ---------------------------------------------------------------------------
// env setup — snapshot/restore the keys we mutate
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  'LLM_API_PROVIDERS',
  'LONGCAT_API_BASE_URL',
  'LONGCAT_API_KEY',
  'LONGCAT_MODEL',
  'STOP_ON_LLM_RATE_LIMIT',
] as const;
const ENV_BACKUP: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) ENV_BACKUP[k] = process.env[k];
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (ENV_BACKUP[k] === undefined) delete process.env[k];
    else process.env[k] = ENV_BACKUP[k]!;
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LLM_API_PROVIDERS = 'longcat';
  process.env.LONGCAT_API_BASE_URL = 'https://api.longcat.chat/openai';
  process.env.LONGCAT_API_KEY = 'test-key-1234567890';
  process.env.LONGCAT_MODEL = 'LongCat-2.0';
  delete process.env.STOP_ON_LLM_RATE_LIMIT;
});

describe('cleanWithLlmDirect', () => {
  it('returns the cleaned content from the first successful provider', async () => {
    fetchMock.mockResolvedValue(okResponse('---\ntitle: X\n---\n\n# X\nbody'));

    const result = await cleanWithLlmDirect({ rawText: 'raw text' });

    expect(result).toBe('---\ntitle: X\n---\n\n# X\nbody');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, opts] = fetchMock.mock.calls[0]!;
    expect(opts).toMatchObject({ method: 'POST' });
    const body = JSON.parse(opts.body as string);
    expect(body.model).toBe('LongCat-2.0');
    expect(body.temperature).toBe(0.2);
  });

  it('throws StopCleaningError on a rate-limit response (STOP default true)', async () => {
    fetchMock.mockResolvedValue(errResponse(429, '{"error":"rate_limit"}'));

    await expect(cleanWithLlmDirect({ rawText: 'raw' })).rejects.toThrow(StopCleaningError);
  });

  it('throws a regular Error (not StopCleaningError) on rate-limit when STOP_ON_LLM_RATE_LIMIT=false', async () => {
    process.env.STOP_ON_LLM_RATE_LIMIT = 'false';
    fetchMock.mockResolvedValue(errResponse(429, '{"error":"rate_limit"}'));

    await expect(cleanWithLlmDirect({ rawText: 'raw' })).rejects.not.toThrow(StopCleaningError);
    await expect(cleanWithLlmDirect({ rawText: 'raw' })).rejects.toThrow(/API failed/);
  });

  it('throws a regular Error on a non-rate-limit failure', async () => {
    fetchMock.mockResolvedValue(errResponse(500, 'internal error'));

    await expect(cleanWithLlmDirect({ rawText: 'raw' })).rejects.toThrow(/API failed/);
  });

  it('throws when no provider is configured', async () => {
    delete process.env.LONGCAT_API_KEY;

    await expect(cleanWithLlmDirect({ rawText: 'raw' })).rejects.toThrow(/未配置/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bakes maxOutputChars into the system prompt when provided', async () => {
    fetchMock.mockResolvedValue(okResponse('ok'));

    await cleanWithLlmDirect({ rawText: 'raw', maxOutputChars: 4500 });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.messages[0].content).toContain('4500');
  });

  it('slices rawText to 40K characters in the user prompt', async () => {
    fetchMock.mockResolvedValue(okResponse('ok'));
    const huge = 'a'.repeat(50_000);

    await cleanWithLlmDirect({ rawText: huge });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    // 40K slice + the prompt wrapper — the raw text portion must be exactly 40K
    expect(body.messages[1].content).toContain('a'.repeat(40_000));
    expect(body.messages[1].content).not.toContain('a'.repeat(40_001));
  });

  it('appends reviewer feedback to the user prompt when provided', async () => {
    fetchMock.mockResolvedValue(okResponse('ok'));

    await cleanWithLlmDirect({ rawText: 'raw', feedback: '{"comments":["too verbose"]}' });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.messages[1].content).toContain('Reviewer Feedback');
    expect(body.messages[1].content).toContain('too verbose');
  });

  it('respects an already-aborted signal', async () => {
    // When the external signal is aborted, callProvider aborts its own
    // controller and fetch throws. The error propagates (not StopCleaningError).
    fetchMock.mockImplementation((_url: string, opts: RequestInit) =>
      opts.signal?.aborted
        ? Promise.reject(new Error('The operation was aborted'))
        : Promise.resolve(okResponse('ok')),
    );

    await expect(
      cleanWithLlmDirect({ rawText: 'raw', signal: AbortSignal.abort() }),
    ).rejects.toThrow(/aborted/);
  });
});

describe('buildCleanerSystemPrompt', () => {
  it('uses the char-limit rule when maxOutputChars is set', () => {
    const prompt = buildCleanerSystemPrompt({ maxOutputChars: 4500 });
    expect(prompt).toContain('4500');
    expect(prompt).not.toContain('3000 words');
  });

  it('uses the word-limit rule when maxOutputChars is omitted', () => {
    const prompt = buildCleanerSystemPrompt();
    expect(prompt).toContain('3000 words');
  });

  it('marks source_url optional (for file uploads)', () => {
    const prompt = buildCleanerSystemPrompt();
    expect(prompt.toLowerCase()).toContain('source_url');
    expect(prompt.toLowerCase()).toContain('omit');
  });
});
