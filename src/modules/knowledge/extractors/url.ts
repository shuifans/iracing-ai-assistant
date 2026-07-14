/**
 * URL Fetcher with SSRF protection — SPEC 13.2
 *
 * Implements: HTTPS-only, hostname validation, DNS rebinding protection,
 * manual redirect handling with re-validation, timeout and size limits,
 * Readability-based content extraction.
 *
 * @module knowledge/extractors/url
 */

import dns from 'dns';
import https from 'https';
import net from 'net';
import type { ClientRequest, IncomingMessage } from 'http';
import type { RequestOptions as HttpsRequestOptions } from 'https';
import type { LookupAddress } from 'dns';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import type { ExtractionResult } from '@/modules/knowledge/types';
import { AppError } from '@/lib/errors';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UrlFetchOptions {
  /** Maximum response body size in bytes (from env URL_FETCH_MAX_BYTES). */
  maxBytes: number;
  /** TCP connection timeout in milliseconds. Default: 5000. */
  connectTimeoutMs: number;
  /** Total download timeout in milliseconds. Default: 15000. */
  downloadTimeoutMs: number;
  /** Maximum number of redirects to follow. Default: 3. */
  maxRedirects: number;
  /** Optional caller cancellation (the worker hard timeout passes this). */
  signal?: AbortSignal;
  /** Injectable network boundary for deterministic security tests. */
  network?: UrlNetworkDependencies;
}

export interface UrlNetworkDependencies {
  /** Resolve DNS records for a hostname. Production requests every IPv4 A record. */
  lookup: (hostname: string) => Promise<readonly LookupAddress[]>;
  /** Node HTTPS request implementation. */
  request: (
    options: HttpsRequestOptions,
    onResponse: (response: IncomingMessage) => void,
  ) => ClientRequest;
}

const DEFAULT_NETWORK: UrlNetworkDependencies = {
  lookup: (hostname) => dns.promises.lookup(hostname, { all: true, family: 4, verbatim: true }),
  request: (options, onResponse) => https.request(options, onResponse),
};

// ---------------------------------------------------------------------------
// SSRF helpers
// ---------------------------------------------------------------------------

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Convert an IPv4 dotted-quad string to a 32-bit unsigned integer.
 * Returns null if the string is not a valid IPv4 address.
 */
function ipv4ToNumber(ip: string): number | null {
  const match = IPV4_RE.exec(ip);
  if (!match) return null;
  const parts = [match[1], match[2], match[3], match[4]].map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function isPrivateOrReservedIpv4(ip: string): boolean {
  const num = ipv4ToNumber(ip);
  if (num === null) return false;

  // 0.0.0.0/8 (unspecified)
  if ((num & 0xff000000) >>> 0 === 0x00000000) return true;
  // 10.0.0.0/8
  if ((num & 0xff000000) >>> 0 === 0x0a000000) return true;
  // 100.64.0.0/10 (shared address space)
  if ((num & 0xffc00000) >>> 0 === 0x64400000) return true;
  // 127.0.0.0/8 (loopback)
  if ((num & 0xff000000) >>> 0 === 0x7f000000) return true;
  // 169.254.0.0/16 (link-local)
  if ((num & 0xffff0000) >>> 0 === 0xa9fe0000) return true;
  // 172.16.0.0/12
  if ((num & 0xfff00000) >>> 0 === 0xac100000) return true;
  // 192.168.0.0/16
  if ((num & 0xffff0000) >>> 0 === 0xc0a80000) return true;
  // 192.0.0.0/24 and documentation ranges
  if ((num & 0xffffff00) >>> 0 === 0xc0000000) return true;
  if ((num & 0xffffff00) >>> 0 === 0xc0000200) return true;
  // 192.88.99.0/24 (deprecated 6to4 relay)
  if ((num & 0xffffff00) >>> 0 === 0xc0586300) return true;
  // 198.18.0.0/15 (benchmarking)
  if ((num & 0xfffe0000) >>> 0 === 0xc6120000) return true;
  // Documentation ranges
  if ((num & 0xffffff00) >>> 0 === 0xc6336400) return true;
  if ((num & 0xffffff00) >>> 0 === 0xcb007100) return true;
  // 224.0.0.0/4 multicast and 240.0.0.0/4 reserved/broadcast
  if (num >>> 28 >= 0x0e) return true;

  return false;
}

/** Returns true when the string looks like an IPv4 or IPv6 address. */
function looksLikeIpAddress(hostname: string): boolean {
  // IPv4
  if (IPV4_RE.test(hostname)) return true;
  // IPv6 bracket notation is stripped by URL parser, but check anyway
  if (hostname.includes(':')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Validation steps
// ---------------------------------------------------------------------------

/**
 * Parse and validate the URL. Enforces HTTPS-only and rejects user-info.
 * Throws AppError(VALIDATION_ERROR) on failure.
 */
function parseUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AppError('VALIDATION_ERROR', `Invalid URL: ${raw}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new AppError('VALIDATION_ERROR', `Only HTTPS URLs are allowed; got "${parsed.protocol}"`);
  }

  if (parsed.username || parsed.password) {
    throw new AppError(
      'VALIDATION_ERROR',
      'URLs with embedded credentials (user:pass@host) are forbidden',
    );
  }

  return parsed;
}

/**
 * Validate the hostname — must be a real domain name, not an IP address,
 * not localhost or any other reserved name.
 */
function validateHost(url: URL): void {
  const { hostname } = url;

  if (!hostname) {
    throw new AppError('VALIDATION_ERROR', 'URL has no hostname');
  }

  const lower = hostname.toLowerCase();

  // Block localhost variants
  if (lower === 'localhost' || lower.endsWith('.localhost')) {
    throw new AppError('VALIDATION_ERROR', `Forbidden hostname: "${hostname}"`);
  }

  // Block bare IP addresses — domain name required
  if (looksLikeIpAddress(hostname)) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Bare IP addresses are not allowed; use a domain name. Got: "${hostname}"`,
    );
  }
}

/**
 * Resolve and validate every IPv4 A result, then pin one validated address.
 * Legitimate AAAA results from injected resolvers are ignored deliberately:
 * this fetcher is IPv4-only and never offers them to the socket layer.
 */
async function validateDns(
  hostname: string,
  network: UrlNetworkDependencies,
  signal: AbortSignal,
): Promise<LookupAddress> {
  let results: readonly LookupAddress[];
  try {
    results = await waitForAbort(network.lookup(hostname), signal);
  } catch (err) {
    if (signal.aborted) throw abortReason(signal);
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError('WEB_FETCH_FAILED', `DNS lookup failed for "${hostname}": ${msg}`);
  }

  if (results.length === 0) {
    throw new AppError('WEB_FETCH_FAILED', `DNS lookup returned no addresses for "${hostname}"`);
  }

  const ipv4Results: LookupAddress[] = [];
  for (const result of results) {
    const actualFamily = net.isIP(result.address);
    if (actualFamily === 0 || actualFamily !== result.family) {
      throw new AppError(
        'VALIDATION_ERROR',
        `DNS returned invalid address/family pair "${result.address}" (reported IPv${result.family}); request blocked`,
      );
    }
    // The production resolver requests family 4. An injected resolver may
    // still return a complete A/AAAA set; valid AAAA records are irrelevant to
    // this IPv4-only transport and must never reach the socket lookup.
    if (actualFamily === 6) continue;

    if (isPrivateOrReservedIpv4(result.address)) {
      throw new AppError(
        'VALIDATION_ERROR',
        `DNS resolved "${hostname}" to private/reserved IP "${result.address}"; request blocked`,
      );
    }
    ipv4Results.push(result);
  }

  if (ipv4Results.length === 0) {
    throw new AppError(
      'WEB_FETCH_FAILED',
      `DNS lookup returned no IPv4 A records for "${hostname}"`,
    );
  }

  return ipv4Results[0]!;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('URL fetch aborted');
}

async function waitForAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortReason(signal);

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Fetch with manual redirect handling
// ---------------------------------------------------------------------------

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

interface DownloadedPage {
  statusCode: number;
  statusMessage: string;
  location?: string;
  rawHtml: string;
  truncated: boolean;
}

type PinnedLookup = NonNullable<HttpsRequestOptions['lookup']>;

function createPinnedLookup(pinned: LookupAddress): PinnedLookup {
  return ((_hostname, options, callback) => {
    const wantsAll = typeof options === 'object' && options.all === true;
    queueMicrotask(() => {
      if (wantsAll) {
        const allCallback = callback as unknown as (
          error: NodeJS.ErrnoException | null,
          addresses: LookupAddress[],
        ) => void;
        allCallback(null, [pinned]);
        return;
      }

      const oneCallback = callback as unknown as (
        error: NodeJS.ErrnoException | null,
        address: string,
        family: number,
      ) => void;
      oneCallback(null, pinned.address, pinned.family);
    });
  }) as PinnedLookup;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Perform one HTTPS request. The original hostname remains in hostname,
 * Host and servername so TLS certificate validation is unchanged; only the
 * socket lookup is replaced with the already-validated address.
 */
function requestPinned(
  url: URL,
  pinned: LookupAddress,
  options: UrlFetchOptions,
  network: UrlNetworkDependencies,
  signal: AbortSignal,
): Promise<DownloadedPage> {
  return new Promise<DownloadedPage>((resolve, reject) => {
    let settled = false;
    let response: IncomingMessage | undefined;
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    let request: ClientRequest | undefined;

    const cleanup = () => {
      if (connectTimer) clearTimeout(connectTimer);
      signal.removeEventListener('abort', onAbort);
    };
    const succeed = (result: DownloadedPage) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      const reason = abortReason(signal);
      response?.destroy(reason);
      request?.destroy(reason);
      fail(reason);
    };

    if (signal.aborted) {
      fail(abortReason(signal));
      return;
    }

    try {
      request = network.request(
        {
          protocol: 'https:',
          hostname: url.hostname,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          agent: false,
          servername: url.hostname,
          rejectUnauthorized: true,
          lookup: createPinnedLookup(pinned),
          headers: {
            host: url.host,
            'user-agent': 'iRacing-AI-Assistant/1.0 (+https://iracing-ai.local)',
            accept: 'text/html,application/xhtml+xml,*/*;q=0.9',
          },
        },
        (incoming) => {
          response = incoming;
          if (connectTimer) clearTimeout(connectTimer);

          const statusCode = incoming.statusCode ?? 0;
          const statusMessage = incoming.statusMessage ?? '';
          const location = firstHeader(incoming.headers.location);

          if (REDIRECT_STATUSES.has(statusCode) || statusCode < 200 || statusCode >= 300) {
            incoming.destroy();
            succeed({ statusCode, statusMessage, location, rawHtml: '', truncated: false });
            return;
          }

          const chunks: Buffer[] = [];
          let bytesRead = 0;
          let truncated = false;

          incoming.on('data', (value: Buffer | string) => {
            if (settled) return;
            const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
            const remaining = Math.max(0, options.maxBytes - bytesRead);
            if (chunk.byteLength > remaining) {
              if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
              bytesRead += remaining;
              truncated = true;
              incoming.destroy();
              succeed({
                statusCode,
                statusMessage,
                rawHtml: Buffer.concat(chunks).toString('utf-8'),
                truncated,
              });
              return;
            }

            chunks.push(chunk);
            bytesRead += chunk.byteLength;
          });
          incoming.once('end', () => {
            succeed({
              statusCode,
              statusMessage,
              rawHtml: Buffer.concat(chunks).toString('utf-8'),
              truncated,
            });
          });
          incoming.once('error', fail);
        },
      );
    } catch (error) {
      fail(error);
      return;
    }

    signal.addEventListener('abort', onAbort, { once: true });
    request.once('error', fail);
    connectTimer = setTimeout(() => {
      const error = new Error(`Connection timeout after ${options.connectTimeoutMs}ms`);
      request?.destroy(error);
      fail(error);
    }, options.connectTimeoutMs);
    request.end();
  });
}

/**
 * Fetch the URL following redirects manually. Each redirect target is
 * re-validated (protocol, host, DNS) to prevent SSRF via open redirects.
 */
async function fetchWithRedirects(
  initialUrl: string,
  options: UrlFetchOptions,
  network: UrlNetworkDependencies,
  signal: AbortSignal,
): Promise<DownloadedPage> {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= options.maxRedirects; hop++) {
    const parsed = parseUrl(currentUrl);
    validateHost(parsed);
    const pinned = await validateDns(parsed.hostname, network, signal);
    const response = await requestPinned(parsed, pinned, options, network, signal);

    // Not a redirect — return the response
    if (!REDIRECT_STATUSES.has(response.statusCode)) {
      return response;
    }

    // Handle redirect
    const location = response.location;
    if (!location) {
      throw new AppError(
        'WEB_FETCH_FAILED',
        `Redirect status ${response.statusCode} without Location header`,
      );
    }

    // Resolve relative redirects
    try {
      currentUrl = new URL(location, currentUrl).toString();
    } catch {
      throw new AppError('WEB_FETCH_FAILED', `Invalid redirect Location: "${location}"`);
    }

    // Re-validate the redirect target on the next loop iteration
  }

  throw new AppError(
    'WEB_FETCH_FAILED',
    `Too many redirects (>${options.maxRedirects}) while fetching "${initialUrl}"`,
  );
}

// ---------------------------------------------------------------------------
// Readability extraction
// ---------------------------------------------------------------------------

/**
 * Extract the main article text from HTML using JSDOM + Readability.
 * Throws AppError(EXTRACTION_FAILED) when extraction yields no content.
 */
function extractWithReadability(html: string): string {
  let document: Document;
  try {
    const dom = new JSDOM(html);
    document = dom.window.document;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError('EXTRACTION_FAILED', `Failed to parse HTML: ${msg}`);
  }

  const reader = new Readability(document);
  const article = reader.parse();

  if (!article || !article.textContent?.trim()) {
    throw new AppError(
      'EXTRACTION_FAILED',
      'Readability could not extract meaningful content from the page',
    );
  }

  return article.textContent.trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch a URL with full SSRF protection and extract readable text content.
 *
 * @param url     - The HTTPS URL to fetch.
 * @param options - Fetch and security options.
 * @returns ExtractionResult with the extracted text content.
 * @throws AppError on validation, network, or extraction failures.
 */
export async function fetchUrl(url: string, options: UrlFetchOptions): Promise<ExtractionResult> {
  const network = options.network ?? DEFAULT_NETWORK;
  const operationAbort = new AbortController();
  const timeoutError = new Error(`Download timeout after ${options.downloadTimeoutMs}ms`);
  const deadline = setTimeout(() => operationAbort.abort(timeoutError), options.downloadTimeoutMs);
  const onCallerAbort = () => operationAbort.abort(options.signal?.reason);

  if (options.signal?.aborted) {
    onCallerAbort();
  } else {
    options.signal?.addEventListener('abort', onCallerAbort, { once: true });
  }

  let response: DownloadedPage;
  try {
    response = await fetchWithRedirects(url, options, network, operationAbort.signal);
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError('WEB_FETCH_FAILED', `HTTP request failed: ${message}`);
  } finally {
    clearTimeout(deadline);
    options.signal?.removeEventListener('abort', onCallerAbort);
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new AppError(
      'WEB_FETCH_FAILED',
      `HTTP ${response.statusCode} ${response.statusMessage} while fetching "${url}"`,
    );
  }

  const { rawHtml, truncated } = response;

  // Extract readable text only after the complete (or size-truncated) body
  // has been consumed while the total deadline remained active.
  const text = extractWithReadability(rawHtml);

  const warnings: string[] = [];
  if (truncated) {
    warnings.push(`Response body exceeded ${options.maxBytes} bytes and was truncated`);
  }

  return {
    text,
    charCount: text.length,
    truncated,
    warnings,
  };
}
