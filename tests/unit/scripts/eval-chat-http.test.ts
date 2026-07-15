import { describe, expect, it, vi } from 'vitest';
import * as support from '../../../scripts/eval-chat-support';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const enabledSource = {
  id: 'support-source',
  url: 'https://support.iracing.com/',
  scopeType: 'domain',
  enabled: true,
};

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

describe('HTTP chat eval support', () => {
  it('exposes testable authentication, fixture and network failure helpers', () => {
    expect(support).toMatchObject({
      requireEvalAdminToken: expect.any(Function),
      ensureHttpWebKnowledgeFixture: expect.any(Function),
      isNetworkUnavailableError: expect.any(Function),
      isHttpEvalRequired: expect.any(Function),
      shouldSkipHttpEvalFailure: expect.any(Function),
      consumeChatEvalSse: expect.any(Function),
    });
  });

  it('requires a real administrator token without transforming or logging it', () => {
    expect(() => support.requireEvalAdminToken({})).toThrow('EVAL_ADMIN_TOKEN');
    expect(() => support.requireEvalAdminToken({ EVAL_ADMIN_TOKEN: '   ' })).toThrow(
      'EVAL_ADMIN_TOKEN',
    );
    expect(support.requireEvalAdminToken({ EVAL_ADMIN_TOKEN: 'real-admin-token' })).toBe(
      'real-admin-token',
    );
  });

  it('treats explicit HTTP modes and URLs as required', () => {
    expect(support.isHttpEvalRequired([], 'both')).toBe(false);
    expect(support.isHttpEvalRequired(['--mode', 'http'], 'http')).toBe(true);
    expect(support.isHttpEvalRequired(['--mode', 'both'], 'both')).toBe(true);
    expect(support.isHttpEvalRequired(['--http-url', 'https://eval.example'], 'both')).toBe(true);
    expect(support.isHttpEvalRequired(['--http-url', 'https://eval.example'], 'direct')).toBe(
      false,
    );
  });

  it('classifies only genuine connection failures as optional-skip candidates', () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT']) {
      expect(
        support.isNetworkUnavailableError(new TypeError('fetch failed', { cause: { code } })),
      ).toBe(true);
    }
    expect(support.isNetworkUnavailableError(new Error('HTTP 401'))).toBe(false);
    expect(support.isNetworkUnavailableError(new SyntaxError('bad json'))).toBe(false);
  });

  it('skips only optional probes with genuine network unavailability', () => {
    const refused = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    expect(support.shouldSkipHttpEvalFailure(refused, false)).toBe(true);
    expect(support.shouldSkipHttpEvalFailure(refused, true)).toBe(false);
    expect(support.shouldSkipHttpEvalFailure(new Error('health 500'), false)).toBe(false);
    expect(support.shouldSkipHttpEvalFailure(new Error('HTTP 401'), false)).toBe(false);
    expect(support.shouldSkipHttpEvalFailure(new SyntaxError('malformed JSON'), false)).toBe(false);
  });

  it('leaves an existing enabled official source unchanged', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        success: true,
        data: {
          sources: [enabledSource, { ...enabledSource, id: 'other', url: 'https://example.com/' }],
        },
      }),
    );

    await support.ensureHttpWebKnowledgeFixture('https://eval.example', 'admin-token', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: 'Bearer admin-token' }),
    });
  });

  it('enables an existing disabled official source without deleting or widening it', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: { sources: [{ ...enabledSource, enabled: false }] } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: { source: { ...enabledSource, enabled: true } } }),
      );

    await support.ensureHttpWebKnowledgeFixture('https://eval.example', 'admin-token', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      'https://eval.example/api/knowledge/web-sources/support-source',
    );
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ enabled: true }),
      headers: expect.objectContaining({
        Authorization: 'Bearer admin-token',
        Origin: 'https://eval.example',
      }),
    });
  });

  it('creates only the narrow official support domain when absent', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { sources: [] } }))
      .mockResolvedValueOnce(
        jsonResponse(
          { success: true, data: { source: { ...enabledSource, sourceLevel: 'official' } } },
          201,
        ),
      );

    await support.ensureHttpWebKnowledgeFixture('https://eval.example', 'admin-token', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('https://eval.example/api/knowledge/web-sources');
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify(support.EVAL_OFFICIAL_WEB_SOURCE),
    });
    expect(JSON.parse(fetchImpl.mock.calls[1]?.[1]?.body as string)).toMatchObject({
      scopeType: 'domain',
      url: 'https://support.iracing.com/',
      sourceLevel: 'official',
      enabled: true,
    });
  });

  it.each([401, 403, 500])(
    'fails explicitly when the administrator API returns HTTP %s',
    async (status) => {
      const fetchImpl = vi.fn(async () => jsonResponse({ success: false }, status));
      await expect(
        support.ensureHttpWebKnowledgeFixture('https://eval.example', 'admin-token', fetchImpl),
      ).rejects.toThrow(`HTTP ${status}`);
    },
  );

  it('fails explicitly on malformed JSON or an invalid mutation response', async () => {
    const malformed = vi.fn(async () => new Response('not-json', { status: 200 }));
    await expect(
      support.ensureHttpWebKnowledgeFixture('https://eval.example', 'admin-token', malformed),
    ).rejects.toThrow('JSON');

    const invalidMutation = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { sources: [] } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: {} }, 201));
    await expect(
      support.ensureHttpWebKnowledgeFixture('https://eval.example', 'admin-token', invalidMutation),
    ).rejects.toThrow('fixture');
  });

  it('consumes chunked SSE only after a real done/complete event', async () => {
    const metric = { text: '', status: '' };
    await support.consumeChatEvalSse(
      sseResponse([
        ': keepalive\n\nevent: delta\ndata: {"text":"hel',
        'lo","complete":"ordinary-field"}\n\nevent: done\nda',
        'ta: {"status":"complete","grounding":"grounded"}\n\n',
      ]),
      (eventType, data) => {
        const value = data as Record<string, unknown>;
        if (eventType === 'delta') metric.text += String(value.text ?? '');
        if (eventType === 'done') metric.status = String(value.status ?? '');
      },
    );
    expect(metric).toEqual({ text: 'hello', status: 'complete' });
  });

  it('throws a sanitized error immediately for an SSE error event', async () => {
    const secret = 'secret-token-and-payload';
    const failure = support.consumeChatEvalSse(
      sseResponse([`event: error\ndata: {"message":"${secret}","code":"INTERNAL"}\n\n`]),
      vi.fn(),
    );
    await expect(failure).rejects.toThrow('chat SSE reported an error');
    await expect(failure).rejects.not.toThrow(secret);
  });

  it('rejects EOF when the stream never emitted done/complete', async () => {
    await expect(
      support.consumeChatEvalSse(
        sseResponse(['event: delta\ndata: {"text":"partial"}\n\n']),
        vi.fn(),
      ),
    ).rejects.toThrow('done/complete');
  });

  it('rejects truncated JSON and residual unparsed SSE data', async () => {
    await expect(
      support.consumeChatEvalSse(
        sseResponse(['event: done\ndata: {"status":"complete"\n\n']),
        vi.fn(),
      ),
    ).rejects.toThrow('malformed JSON');

    await expect(
      support.consumeChatEvalSse(
        sseResponse([
          'event: done\ndata: {"status":"complete"}\n\nevent: delta\ndata: {"text":"late"}',
        ]),
        vi.fn(),
      ),
    ).rejects.toThrow('trailing');
  });

  it('rejects non-complete done events and data after a complete terminal event', async () => {
    await expect(
      support.consumeChatEvalSse(
        sseResponse(['event: done\ndata: {"status":"failed"}\n\n']),
        vi.fn(),
      ),
    ).rejects.toThrow('done/complete');

    await expect(
      support.consumeChatEvalSse(
        sseResponse([
          'event: done\ndata: {"status":"complete"}\n\nevent: delta\ndata: {"text":"late"}\n\n',
        ]),
        vi.fn(),
      ),
    ).rejects.toThrow('after done/complete');
  });
});
