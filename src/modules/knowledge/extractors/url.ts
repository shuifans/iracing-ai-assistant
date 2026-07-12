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
}

// ---------------------------------------------------------------------------
// SSRF helpers
// ---------------------------------------------------------------------------

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_LOOPBACK = '::1';
const IPV6_LINK_LOCAL_PREFIX = 'fe80:';

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

/**
 * Returns true when the given IP (v4 or v6) is private, link-local, loopback,
 * or otherwise reserved and must not be contacted.
 */
function isPrivateOrReservedIp(ip: string): boolean {
  // IPv6 checks
  const lower = ip.toLowerCase();
  if (lower === IPV6_LOOPBACK) return true;
  if (lower.startsWith(IPV6_LINK_LOCAL_PREFIX)) return true;
  // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1
  if (lower.startsWith('::ffff:')) {
    const v4Part = lower.slice(7);
    if (isPrivateOrReservedIpv4(v4Part)) return true;
  }

  return isPrivateOrReservedIpv4(ip);
}

function isPrivateOrReservedIpv4(ip: string): boolean {
  const num = ipv4ToNumber(ip);
  if (num === null) return false;

  // 0.0.0.0/8 (unspecified)
  if (((num & 0xff000000) >>> 0) === 0x00000000) return true;
  // 10.0.0.0/8
  if (((num & 0xff000000) >>> 0) === 0x0a000000) return true;
  // 127.0.0.0/8 (loopback)
  if (((num & 0xff000000) >>> 0) === 0x7f000000) return true;
  // 169.254.0.0/16 (link-local)
  if (((num & 0xffff0000) >>> 0) === 0xa9fe0000) return true;
  // 172.16.0.0/12
  if (((num & 0xfff00000) >>> 0) === 0xac100000) return true;
  // 192.168.0.0/16
  if (((num & 0xffff0000) >>> 0) === 0xc0a80000) return true;
  // 255.255.255.255 (broadcast)
  if (num === 0xffffffff) return true;

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
    throw new AppError(
      'VALIDATION_ERROR',
      `Only HTTPS URLs are allowed; got "${parsed.protocol}"`,
    );
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
 * Perform DNS resolution and validate that the resolved IP is not private,
 * loopback, link-local, or otherwise reserved (DNS rebinding protection).
 */
async function validateDns(hostname: string): Promise<void> {
  let result: { address: string; family: number };
  try {
    result = await dns.promises.lookup(hostname);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError('WEB_FETCH_FAILED', `DNS lookup failed for "${hostname}": ${msg}`);
  }

  if (isPrivateOrReservedIp(result.address)) {
    throw new AppError(
      'VALIDATION_ERROR',
      `DNS resolved "${hostname}" to private/reserved IP "${result.address}"; request blocked`,
    );
  }
}

// ---------------------------------------------------------------------------
// Fetch with manual redirect handling
// ---------------------------------------------------------------------------

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Fetch the URL following redirects manually. Each redirect target is
 * re-validated (protocol, host, DNS) to prevent SSRF via open redirects.
 */
async function fetchWithRedirects(
  initialUrl: string,
  options: UrlFetchOptions,
): Promise<Response> {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= options.maxRedirects; hop++) {
    const parsed = parseUrl(currentUrl);
    validateHost(parsed);
    await validateDns(parsed.hostname);

    const controller = new AbortController();
    const connectTimer = setTimeout(
      () => controller.abort(new Error('Connection timeout')),
      options.connectTimeoutMs,
    );
    const downloadTimer = setTimeout(
      () => controller.abort(new Error('Download timeout')),
      options.downloadTimeoutMs,
    );

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': 'iRacing-AI-Assistant/1.0 (+https://iracing-ai.local)',
          accept: 'text/html,application/xhtml+xml,*/*;q=0.9',
        },
      });
    } catch (err) {
      clearTimeout(connectTimer);
      clearTimeout(downloadTimer);
      const msg = err instanceof Error ? err.message : String(err);
      throw new AppError('WEB_FETCH_FAILED', `HTTP request failed: ${msg}`);
    }

    clearTimeout(connectTimer);
    clearTimeout(downloadTimer);

    // Not a redirect — return the response
    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    // Handle redirect
    const location = response.headers.get('location');
    if (!location) {
      throw new AppError(
        'WEB_FETCH_FAILED',
        `Redirect status ${response.status} without Location header`,
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
// Body streaming with size limit
// ---------------------------------------------------------------------------

/**
 * Read the response body as text, enforcing the maxBytes limit via streaming.
 * Returns { text, truncated }.
 */
async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  // Prefer streaming when body is available
  if (!response.body) {
    const text = await response.text();
    const truncated = text.length > maxBytes;
    return { text: truncated ? text.slice(0, maxBytes) : text, truncated };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const chunks: string[] =
    [];
  let bytesRead = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        truncated = true;
        reader.cancel();
        break;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } catch {
    // Stream may be cancelled; ignore errors here
  }

  chunks.push(decoder.decode()); // flush
  return { text: chunks.join(''), truncated };
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
export async function fetchUrl(
  url: string,
  options: UrlFetchOptions,
): Promise<ExtractionResult> {
  // Step 1 — Parse and validate the initial URL (protocol, user-info)
  const parsed = parseUrl(url);

  // Step 2 — Validate hostname (no localhost, no bare IP)
  validateHost(parsed);

  // Step 3 — DNS resolution check (anti-rebinding)
  await validateDns(parsed.hostname);

  // Step 4 — Fetch with manual redirect handling
  const response = await fetchWithRedirects(url, options);

  if (!response.ok) {
    throw new AppError(
      'WEB_FETCH_FAILED',
      `HTTP ${response.status} ${response.statusText} while fetching "${url}"`,
    );
  }

  // Step 5 — Read body with size limit
  const { text: rawHtml, truncated } = await readBodyWithLimit(response, options.maxBytes);

  // Step 6 — Extract readable text
  const text = extractWithReadability(rawHtml);

  const warnings: string[] = [];
  if (truncated) {
    warnings.push(
      `Response body exceeded ${options.maxBytes} bytes and was truncated`,
    );
  }

  return {
    text,
    charCount: text.length,
    truncated,
    warnings,
  };
}
