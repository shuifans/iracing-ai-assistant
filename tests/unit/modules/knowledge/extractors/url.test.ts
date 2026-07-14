import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { UrlFetchOptions } from '@/modules/knowledge/extractors/url';
import { AppError } from '@/lib/errors';

// ---------------------------------------------------------------------------
// Mocks — use vi.hoisted so variables exist before vi.mock factories run
// ---------------------------------------------------------------------------

const { mockLookup, mockReadabilityParse, mockJSDOM } = vi.hoisted(() => ({
  mockLookup: vi.fn(),
  mockReadabilityParse: vi.fn(),
  mockJSDOM: vi.fn(),
}));

vi.mock('dns', () => ({
  default: {
    promises: {
      lookup: mockLookup,
    },
  },
  promises: {
    lookup: mockLookup,
  },
}));

vi.mock('@mozilla/readability', () => ({
  Readability: vi.fn(function () {
    return { parse: mockReadabilityParse };
  }),
}));

vi.mock('jsdom', () => ({
  JSDOM: vi.fn(function () {
    return mockJSDOM();
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultOptions(overrides: Partial<UrlFetchOptions> = {}): UrlFetchOptions {
  return {
    maxBytes: 5_242_880,
    connectTimeoutMs: 5000,
    downloadTimeoutMs: 15000,
    maxRedirects: 3,
    ...overrides,
  };
}

interface FakeHttpsRoute {
  statusCode?: number;
  statusMessage?: string;
  headers?: Record<string, string>;
  body?: string;
  bodyDelayMs?: number;
  responseDelayMs?: number;
  neverEnds?: boolean;
  requestError?: Error;
}

function createPinnedHttpsFixture(
  routes: string | FakeHttpsRoute | FakeHttpsRoute[],
  lookupAll = false,
) {
  const routeQueue: FakeHttpsRoute[] = Array.isArray(routes)
    ? [...routes]
    : [typeof routes === 'string' ? { body: routes } : routes];
  const connectedAddresses: string[] = [];
  const connectedFamilies: number[] = [];
  const requestOptionsSeen: Array<Record<string, unknown>> = [];
  const destroyedRequests: Error[] = [];
  let destroyedResponses = 0;
  const request = vi.fn(
    (
      requestOptions: {
        hostname?: string;
        lookup?: (
          hostname: string,
          options: { all?: boolean },
          callback: (
            error: Error | null,
            address: string | Array<{ address: string; family: number }>,
            family?: number,
          ) => void,
        ) => void;
      },
      onResponse: (
        response: Readable & {
          statusCode?: number;
          statusMessage?: string;
          headers: Record<string, string>;
        },
      ) => void,
    ) => {
      const req = new EventEmitter() as EventEmitter & {
        end: () => void;
        destroy: (error?: Error) => void;
      };
      let response: Readable | undefined;
      let requestDestroyed = false;
      let responseDelivered = false;
      requestOptionsSeen.push(requestOptions as unknown as Record<string, unknown>);
      req.destroy = (error?: Error) => {
        requestDestroyed = true;
        if (error) destroyedRequests.push(error);
        if (responseDelivered) response?.destroy(error);
        if (error) queueMicrotask(() => req.emit('error', error));
      };
      req.end = () => {
        const route = routeQueue.shift();
        if (!route) {
          req.emit('error', new Error('No fake HTTPS route left'));
          return;
        }
        if (route.requestError) {
          req.emit('error', route.requestError);
          return;
        }
        requestOptions.lookup!(requestOptions.hostname!, { all: lookupAll }, (error, address, family) => {
          if (error) {
            req.emit('error', error);
            return;
          }
          const selected = Array.isArray(address)
            ? address[0]!
            : { address, family: family! };
          connectedAddresses.push(selected.address);
          connectedFamilies.push(selected.family);
          let started = false;
          response = new Readable({
            read() {
              if (started) return;
              started = true;
              const send = () => {
                if (route.body) this.push(Buffer.from(route.body));
                if (!route.neverEnds) this.push(null);
              };
              if (route.bodyDelayMs) setTimeout(send, route.bodyDelayMs);
              else send();
            },
          });
          const incoming = response as Readable & {
            statusCode?: number;
            statusMessage?: string;
            headers: Record<string, string>;
          };
          incoming.statusCode = route.statusCode ?? 200;
          incoming.statusMessage = route.statusMessage ?? 'OK';
          incoming.headers = route.headers ?? {
            'content-type': 'text/html; charset=utf-8',
          };
          const originalDestroy = incoming.destroy.bind(incoming);
          incoming.destroy = ((error?: Error) => {
            destroyedResponses += 1;
            return originalDestroy(error);
          }) as typeof incoming.destroy;
          if (route.responseDelayMs) {
            setTimeout(() => {
              if (!requestDestroyed) {
                responseDelivered = true;
                onResponse(incoming);
              }
            }, route.responseDelayMs);
          }
          else {
            responseDelivered = true;
            onResponse(incoming);
          }
        });
      };
      return req;
    },
  );

  return {
    request,
    connectedAddresses,
    connectedFamilies,
    requestOptionsSeen,
    destroyedRequests,
    get destroyedResponses() {
      return destroyedResponses;
    },
  };
}

function optionsWithFixture(
  fixture: ReturnType<typeof createPinnedHttpsFixture>,
  overrides: Partial<UrlFetchOptions> = {},
): UrlFetchOptions {
  return {
    ...defaultOptions(overrides),
    network: {
      lookup: mockLookup,
      request: fixture.request,
    },
  } as unknown as UrlFetchOptions;
}

// ---------------------------------------------------------------------------
// Tests — imported after mocks so the module sees the mocks
// ---------------------------------------------------------------------------

import { fetchUrl } from '@/modules/knowledge/extractors/url';

describe('fetchUrl — SSRF protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLookup.mockReset();
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    mockJSDOM.mockReturnValue({ window: { document: {} } });
    mockReadabilityParse.mockReturnValue({
      textContent: 'Extracted article text',
      title: 'Test Article',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Protocol validation
  // -----------------------------------------------------------------------

  it('rejects non-HTTPS protocols (http)', async () => {
    await expect(fetchUrl('http://example.com', defaultOptions())).rejects.toThrow(AppError);
    await expect(fetchUrl('http://example.com', defaultOptions())).rejects.toThrow(/HTTPS/i);
  });

  it('rejects file:// protocol', async () => {
    await expect(fetchUrl('file:///etc/passwd', defaultOptions())).rejects.toThrow(AppError);
  });

  it('rejects ftp:// protocol', async () => {
    await expect(fetchUrl('ftp://example.com/file', defaultOptions())).rejects.toThrow(AppError);
  });

  // -----------------------------------------------------------------------
  // Hostname validation
  // -----------------------------------------------------------------------

  it('rejects localhost', async () => {
    await expect(fetchUrl('https://localhost/', defaultOptions())).rejects.toThrow(AppError);
    await expect(fetchUrl('https://localhost/', defaultOptions())).rejects.toThrow(
      /host|localhost|forbidden/i,
    );
  });

  it('rejects bare IPv4 addresses', async () => {
    await expect(fetchUrl('https://127.0.0.1/', defaultOptions())).rejects.toThrow(AppError);
    await expect(fetchUrl('https://192.168.1.1/', defaultOptions())).rejects.toThrow(AppError);
    await expect(fetchUrl('https://10.0.0.1/', defaultOptions())).rejects.toThrow(AppError);
    await expect(fetchUrl('https://172.16.0.1/', defaultOptions())).rejects.toThrow(AppError);
  });

  it('rejects IPv6 addresses', async () => {
    await expect(fetchUrl('https://[::1]/', defaultOptions())).rejects.toThrow(AppError);
    await expect(fetchUrl('https://[fe80::1]/', defaultOptions())).rejects.toThrow(AppError);
  });

  it('rejects reserved addresses (0.0.0.0, 255.255.255.255)', async () => {
    await expect(fetchUrl('https://0.0.0.0/', defaultOptions())).rejects.toThrow(AppError);
    await expect(fetchUrl('https://255.255.255.255/', defaultOptions())).rejects.toThrow(AppError);
  });

  it('rejects URLs with user info (user:pass@host)', async () => {
    await expect(fetchUrl('https://user:pass@example.com/', defaultOptions())).rejects.toThrow(
      AppError,
    );
    await expect(fetchUrl('https://user:pass@example.com/', defaultOptions())).rejects.toThrow(
      /user|credential|forbidden/i,
    );
  });

  // -----------------------------------------------------------------------
  // DNS rebinding protection
  // -----------------------------------------------------------------------

  it('rejects when DNS resolves to a private IPv4 address', async () => {
    mockLookup.mockResolvedValue([{ address: '192.168.1.100', family: 4 }]);
    await expect(fetchUrl('https://evil.example.com/', defaultOptions())).rejects.toThrow(
      /private|internal|dns|forbidden|blocked/i,
    );
  });

  it('rejects when DNS resolves to loopback (127.x)', async () => {
    mockLookup.mockResolvedValue([{ address: '127.0.0.2', family: 4 }]);
    await expect(fetchUrl('https://evil.example.com/', defaultOptions())).rejects.toThrow(AppError);
  });

  it('rejects when DNS resolves to link-local (169.254.x)', async () => {
    mockLookup.mockResolvedValue([{ address: '169.254.1.1', family: 4 }]);
    await expect(fetchUrl('https://evil.example.com/', defaultOptions())).rejects.toThrow(AppError);
  });

  it('rejects when DNS resolves to IPv6 loopback (::1)', async () => {
    mockLookup.mockResolvedValue([{ address: '::1', family: 6 }]);
    await expect(fetchUrl('https://evil.example.com/', defaultOptions())).rejects.toThrow(AppError);
  });

  it.each(['2001:4860::1', '2606:4700::1', '2a00::1'])(
    'rejects an AAAA-only answer even when IPv6 is globally routable (%s)',
    async (address) => {
      mockLookup.mockResolvedValue([{ address, family: 6 }]);
      const fixture = createPinnedHttpsFixture('<html></html>');

      await expect(
        fetchUrl('https://ipv6-only.example.com/', optionsWithFixture(fixture)),
      ).rejects.toThrow(/IPv4|A record/i);
      expect(fixture.request).not.toHaveBeenCalled();
    },
  );

  it('requests every IPv4 A record from the production DNS resolver', async () => {
    mockLookup.mockResolvedValue([{ address: '2606:4700::1', family: 6 }]);

    await expect(fetchUrl('https://ipv6-only.example.com/', defaultOptions())).rejects.toThrow(
      /IPv4|A record/i,
    );
    expect(mockLookup).toHaveBeenCalledWith('ipv6-only.example.com', {
      all: true,
      family: 4,
      verbatim: true,
    });
  });

  it('rejects DNS records whose reported family does not match the address', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 6 }]);
    const fixture = createPinnedHttpsFixture('<html></html>');

    await expect(
      fetchUrl('https://family-mismatch.example.com/', optionsWithFixture(fixture)),
    ).rejects.toThrow(/family|invalid|blocked/i);
    expect(fixture.request).not.toHaveBeenCalled();
  });

  it('rejects the whole hostname when DNS returns mixed public and private addresses', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '192.168.1.100', family: 4 },
    ]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><body><p>must not be fetched</p></body></html>', { status: 200 }),
    );

    await expect(fetchUrl('https://mixed.example.com/', defaultOptions())).rejects.toThrow(
      /private|reserved|blocked/i,
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('ignores a public AAAA when a validated public A exists and pins IPv4', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700::1', family: 6 },
    ]);
    const fixture = createPinnedHttpsFixture(
      '<html><body><article>dual stack response</article></body></html>',
    );

    await expect(
      fetchUrl('https://dual-stack.example.com/', optionsWithFixture(fixture)),
    ).resolves.toMatchObject({ text: 'Extracted article text' });
    expect(fixture.connectedAddresses).toEqual(['93.184.216.34']);
    expect(fixture.connectedFamilies).toEqual([4]);
  });

  it('pins the validated address into the HTTPS request lookup callback', async () => {
    mockLookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const fixture = createPinnedHttpsFixture(
      '<html><body><article><p>safe response</p></article></body></html>',
    );

    await fetchUrl('https://rebind.example.com/article', optionsWithFixture(fixture));

    expect(mockLookup).toHaveBeenCalledTimes(1);
    expect(fixture.connectedAddresses).toEqual(['93.184.216.34']);
    expect(fixture.connectedFamilies).toEqual([4]);
  });

  it('does not open a socket when DNS returns only AAAA records', async () => {
    mockLookup.mockResolvedValue([{ address: '2606:4700::1', family: 6 }]);
    const fixture = createPinnedHttpsFixture('<html></html>', true);

    await expect(
      fetchUrl('https://ipv6.example.com/article', optionsWithFixture(fixture)),
    ).rejects.toThrow(/IPv4|A record/i);

    expect(fixture.request).not.toHaveBeenCalled();
  });
});

describe('fetchUrl — normal fetch', () => {
  const sampleHtml = `
    <html>
      <head><title>Test Article</title></head>
      <body>
        <article>
          <h1>Test Title</h1>
          <p>This is the article content with enough text to pass Readability thresholds.</p>
        </article>
      </body>
    </html>
  `;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLookup.mockReset();
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    mockJSDOM.mockReturnValue({ window: { document: {} } });
    mockReadabilityParse.mockReturnValue({
      textContent: 'Test Title\n\nThis is the article content.',
      title: 'Test Title',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches a valid HTTPS URL and extracts text via Readability', async () => {
    const fixture = createPinnedHttpsFixture(sampleHtml);
    const result = await fetchUrl('https://example.com/article', optionsWithFixture(fixture));

    expect(result.text).toBe('Test Title\n\nThis is the article content.');
    expect(result.charCount).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('calls DNS lookup before making the HTTP request', async () => {
    const fixture = createPinnedHttpsFixture(sampleHtml);
    await fetchUrl('https://example.com/article', optionsWithFixture(fixture));

    expect(mockLookup).toHaveBeenCalledWith('example.com');
    expect(mockLookup).toHaveBeenCalledTimes(1);
    expect(fixture.request).toHaveBeenCalledTimes(1);
  });

  it('preserves hostname, Host header, SNI and certificate checks while pinning', async () => {
    const fixture = createPinnedHttpsFixture(sampleHtml);
    await fetchUrl('https://example.com:8443/article?q=1', optionsWithFixture(fixture));

    expect(fixture.requestOptionsSeen[0]).toMatchObject({
      hostname: 'example.com',
      port: '8443',
      path: '/article?q=1',
      servername: 'example.com',
      rejectUnauthorized: true,
      agent: false,
      headers: expect.objectContaining({ host: 'example.com:8443' }),
    });
  });

  it('sets truncated=true when response body exceeds maxBytes', async () => {
    // Build a response whose byte length exceeds the tiny maxBytes limit
    const bigBody = '<html><body>' + '<p>padding text</p>'.repeat(20) + '</body></html>';
    const fixture = createPinnedHttpsFixture(bigBody);

    const result = await fetchUrl(
      'https://example.com/big',
      optionsWithFixture(fixture, { maxBytes: 50 }),
    );

    expect(result.truncated).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(fixture.destroyedResponses).toBeGreaterThan(0);
  });

  it('throws AppError on a network request error', async () => {
    const fixture = createPinnedHttpsFixture({ requestError: new Error('ENOTFOUND') });

    await expect(
      fetchUrl('https://timeout.example.com/', optionsWithFixture(fixture)),
    ).rejects.toThrow(AppError);
  });

  it('keeps the total deadline active while a slow response body is being read', async () => {
    const fixture = createPinnedHttpsFixture({ body: sampleHtml, bodyDelayMs: 50 });

    await expect(
      fetchUrl('https://slow.example.com/', optionsWithFixture(fixture, { downloadTimeoutMs: 10 })),
    ).rejects.toThrow(/timeout/i);
    expect(fixture.destroyedRequests).toHaveLength(1);
  });

  it('aborts an infinite response body at the total deadline', async () => {
    const fixture = createPinnedHttpsFixture({ body: '<html>', neverEnds: true });

    await expect(
      fetchUrl(
        'https://infinite.example.com/',
        optionsWithFixture(fixture, { downloadTimeoutMs: 10 }),
      ),
    ).rejects.toThrow(/timeout/i);
    expect(fixture.destroyedRequests).toHaveLength(1);
  });

  it('destroys an in-flight body when the caller aborts', async () => {
    const fixture = createPinnedHttpsFixture({ body: '<html>', neverEnds: true });
    const callerAbort = new AbortController();
    const result = fetchUrl(
      'https://abort.example.com/',
      optionsWithFixture(fixture, {
        signal: callerAbort.signal,
        downloadTimeoutMs: 1000,
      }),
    );
    setTimeout(() => callerAbort.abort(new Error('worker hard timeout')), 5);

    await expect(result).rejects.toThrow(/worker hard timeout/i);
    expect(fixture.destroyedRequests).toHaveLength(1);
  });

  it('enforces one cumulative deadline across redirects rather than resetting per hop', async () => {
    const fixture = createPinnedHttpsFixture([
      {
        statusCode: 302,
        headers: { location: 'https://second.example.com/article' },
        responseDelayMs: 8,
      },
      { body: sampleHtml, responseDelayMs: 8 },
    ]);

    await expect(
      fetchUrl(
        'https://first.example.com/article',
        optionsWithFixture(fixture, { downloadTimeoutMs: 12 }),
      ),
    ).rejects.toThrow(/timeout/i);
    expect(fixture.request).toHaveBeenCalledTimes(2);
    expect(fixture.destroyedRequests).toHaveLength(1);
  });

  it('removes caller abort handling after a successful fetch', async () => {
    const fixture = createPinnedHttpsFixture(sampleHtml);
    const callerAbort = new AbortController();

    await fetchUrl(
      'https://cleanup.example.com/',
      optionsWithFixture(fixture, { signal: callerAbort.signal }),
    );
    callerAbort.abort(new Error('late abort'));
    await Promise.resolve();

    expect(fixture.destroyedRequests).toEqual([]);
  });

  it('throws AppError when Readability returns null', async () => {
    mockReadabilityParse.mockReturnValue(null);
    const fixture = createPinnedHttpsFixture(sampleHtml);

    await expect(
      fetchUrl('https://empty.example.com/article', optionsWithFixture(fixture)),
    ).rejects.toThrow(AppError);
  });
});

describe('fetchUrl — redirects', () => {
  const sampleHtml = '<html><body><p>Final content</p></body></html>';

  beforeEach(() => {
    vi.clearAllMocks();
    mockLookup.mockReset();
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    mockJSDOM.mockReturnValue({ window: { document: {} } });
    mockReadabilityParse.mockReturnValue({
      textContent: 'Final content',
      title: 'Final',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('follows up to maxRedirects redirects', async () => {
    const fixture = createPinnedHttpsFixture([
      { statusCode: 301, headers: { location: 'https://example.com/step2' } },
      { statusCode: 302, headers: { location: 'https://example.com/step3' } },
      { body: sampleHtml },
    ]);

    const result = await fetchUrl('https://example.com/start', optionsWithFixture(fixture));
    expect(result.text).toBe('Final content');
    expect(fixture.request).toHaveBeenCalledTimes(3);
    expect(mockLookup).toHaveBeenCalledTimes(3);
  });

  it('rejects when redirect chain exceeds maxRedirects', async () => {
    const fixture = createPinnedHttpsFixture(
      Array.from({ length: 5 }, (_, index) => ({
        statusCode: 302,
        headers: { location: `https://example.com/step${index + 2}` },
      })),
    );

    await expect(
      fetchUrl('https://example.com/start', optionsWithFixture(fixture)),
    ).rejects.toThrow(/redirect/i);
  });

  it('rejects redirect to an internal/private URL', async () => {
    const fixture = createPinnedHttpsFixture({
      statusCode: 302,
      headers: { location: 'http://192.168.1.1/admin' },
    });

    await expect(
      fetchUrl('https://example.com/redirect-internal', optionsWithFixture(fixture)),
    ).rejects.toThrow(AppError);
  });

  it('rejects redirect to localhost', async () => {
    const fixture = createPinnedHttpsFixture({
      statusCode: 302,
      headers: { location: 'https://localhost/secret' },
    });

    await expect(
      fetchUrl('https://example.com/redirect-localhost', optionsWithFixture(fixture)),
    ).rejects.toThrow(AppError);
  });

  it('re-resolves every redirect and blocks a private address before connecting', async () => {
    mockLookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);
    const fixture = createPinnedHttpsFixture([
      {
        statusCode: 302,
        headers: { location: 'https://redirect-target.example.com/secret' },
      },
      { body: sampleHtml },
    ]);

    await expect(
      fetchUrl('https://example.com/start', optionsWithFixture(fixture)),
    ).rejects.toThrow(/private|reserved|blocked/i);
    expect(mockLookup).toHaveBeenCalledTimes(2);
    expect(fixture.request).toHaveBeenCalledTimes(1);
  });
});
