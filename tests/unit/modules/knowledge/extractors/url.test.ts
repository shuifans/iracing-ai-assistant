import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  Readability: vi.fn().mockImplementation(() => ({
    parse: mockReadabilityParse,
  })),
}));

vi.mock('jsdom', () => ({
  JSDOM: vi.fn().mockImplementation((...args: unknown[]) => mockJSDOM(...args)),
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

// ---------------------------------------------------------------------------
// Tests — imported after mocks so the module sees the mocks
// ---------------------------------------------------------------------------

import { fetchUrl } from '@/modules/knowledge/extractors/url';

describe('fetchUrl — SSRF protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 });
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
    await expect(fetchUrl('http://example.com', defaultOptions())).rejects.toThrow(
      /HTTPS/i,
    );
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
    await expect(
      fetchUrl('https://user:pass@example.com/', defaultOptions()),
    ).rejects.toThrow(AppError);
    await expect(
      fetchUrl('https://user:pass@example.com/', defaultOptions()),
    ).rejects.toThrow(/user|credential|forbidden/i);
  });

  // -----------------------------------------------------------------------
  // DNS rebinding protection
  // -----------------------------------------------------------------------

  it('rejects when DNS resolves to a private IPv4 address', async () => {
    mockLookup.mockResolvedValue({ address: '192.168.1.100', family: 4 });
    await expect(fetchUrl('https://evil.example.com/', defaultOptions())).rejects.toThrow(
      AppError,
    );
    await expect(fetchUrl('https://evil.example.com/', defaultOptions())).rejects.toThrow(
      /private|internal|dns|forbidden/i,
    );
  });

  it('rejects when DNS resolves to loopback (127.x)', async () => {
    mockLookup.mockResolvedValue({ address: '127.0.0.2', family: 4 });
    await expect(fetchUrl('https://evil.example.com/', defaultOptions())).rejects.toThrow(
      AppError,
    );
  });

  it('rejects when DNS resolves to link-local (169.254.x)', async () => {
    mockLookup.mockResolvedValue({ address: '169.254.1.1', family: 4 });
    await expect(fetchUrl('https://evil.example.com/', defaultOptions())).rejects.toThrow(
      AppError,
    );
  });

  it('rejects when DNS resolves to IPv6 loopback (::1)', async () => {
    mockLookup.mockResolvedValue({ address: '::1', family: 6 });
    await expect(fetchUrl('https://evil.example.com/', defaultOptions())).rejects.toThrow(
      AppError,
    );
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
    mockLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 });
    mockJSDOM.mockReturnValue({ window: { document: {} } });
    mockReadabilityParse.mockReturnValue({
      textContent: 'Test Title\n\nThis is the article content.',
      title: 'Test Title',
    });

    // Default fetch mock — returns valid HTML
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(sampleHtml, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches a valid HTTPS URL and extracts text via Readability', async () => {
    const result = await fetchUrl('https://example.com/article', defaultOptions());

    expect(result.text).toBe('Test Title\n\nThis is the article content.');
    expect(result.charCount).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('calls DNS lookup before making the HTTP request', async () => {
    await fetchUrl('https://example.com/article', defaultOptions());

    expect(mockLookup).toHaveBeenCalledWith('example.com');
  });

  it('sets truncated=true when response body exceeds maxBytes', async () => {
    // Create a response that appears to exceed the limit via Content-Length header
    const bigBody = 'x'.repeat(200);
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(bigBody, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-length': '100',
        },
      }),
    );

    const result = await fetchUrl(
      'https://example.com/big',
      defaultOptions({ maxBytes: 50 }),
    );

    expect(result.truncated).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('throws AppError on connection timeout', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(
      () => new Promise((_resolve, reject) => reject(new Error('ENOTFOUND'))),
    );

    await expect(
      fetchUrl('https://timeout.example.com/', defaultOptions()),
    ).rejects.toThrow(AppError);
  });

  it('throws AppError when Readability returns null', async () => {
    mockReadabilityParse.mockReturnValue(null);

    await expect(
      fetchUrl('https://empty.example.com/article', defaultOptions()),
    ).rejects.toThrow(AppError);
  });
});

describe('fetchUrl — redirects', () => {
  const sampleHtml = '<html><body><p>Final content</p></body></html>';

  beforeEach(() => {
    vi.clearAllMocks();
    mockLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 });
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
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: 'https://example.com/step2' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/step3' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(sampleHtml, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      );

    const result = await fetchUrl('https://example.com/start', defaultOptions());
    expect(result.text).toBe('Final content');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects when redirect chain exceeds maxRedirects', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    // 4 redirects — exceeds default max of 3
    for (let i = 0; i < 4; i++) {
      fetchMock.mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: `https://example.com/step${i + 2}` },
        }),
      );
    }

    await expect(
      fetchUrl('https://example.com/start', defaultOptions()),
    ).rejects.toThrow(AppError);
    await expect(
      fetchUrl('https://example.com/start', defaultOptions()),
    ).rejects.toThrow(/redirect/i);
  });

  it('rejects redirect to an internal/private URL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://192.168.1.1/admin' },
      }),
    );

    await expect(
      fetchUrl('https://example.com/redirect-internal', defaultOptions()),
    ).rejects.toThrow(AppError);
  });

  it('rejects redirect to localhost', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'https://localhost/secret' },
      }),
    );

    await expect(
      fetchUrl('https://example.com/redirect-localhost', defaultOptions()),
    ).rejects.toThrow(AppError);
  });
});
