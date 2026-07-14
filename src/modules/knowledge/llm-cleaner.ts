/**
 * Shared LLM cleaner — OpenAI-compatible direct cleaning call.
 *
 * Extracted from scripts/seed-wiki.ts so the offline Worker and the seed
 * script share ONE source of truth for the cleaning prompt + provider loop.
 *
 * CRITICAL: reads `process.env` directly and imports NO `@/` modules. This
 * keeps it usable from `scripts/seed-wiki.ts` (which loads .env manually and
 * may not set the full validated env schema vars like JWT_ACCESS_SECRET) —
 * importing `@/config/env` would trigger full Zod validation and break the
 * seed script. This mirrors the deliberate pattern in agent/llm-client.ts.
 *
 * This function does NOT fall back to the Qoder SDK — callers decide that.
 * The Worker (strict-binary) treats any failure as a job failure; seed-wiki
 * wraps it with a Qoder fallback.
 *
 * @module knowledge/llm-cleaner
 */

// ---------------------------------------------------------------------------
// Types & error classes
// ---------------------------------------------------------------------------

export interface OpenAiCompatibleProvider {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Thrown when a provider returns a rate-limit / quota error AND
 * STOP_ON_LLM_RATE_LIMIT is enabled — halts the current cleaning run rather
 * than silently burning Qoder credits. Callers should propagate it.
 */
export class StopCleaningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StopCleaningError';
  }
}

export type CleaningBackend = 'llm-direct' | 'qoder-sdk';

// ---------------------------------------------------------------------------
// Provider resolution (reads process.env directly)
// ---------------------------------------------------------------------------

function maskSecret(value: string): string {
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function getOpenAiCompatibleProviders(): OpenAiCompatibleProvider[] {
  const providerNames = (process.env.LLM_API_PROVIDERS ?? 'longcat')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return providerNames
    .map((name) => {
      const key = name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
      const baseUrl = process.env[`${key}_API_BASE_URL`] ?? process.env[`${key}_BASE_URL`] ?? '';
      const apiKey = process.env[`${key}_API_KEY`] ?? '';
      const model = process.env[`${key}_MODEL`] ?? '';
      if (!baseUrl || !apiKey || !model) return null;
      return { name, baseUrl, apiKey, model };
    })
    .filter((p): p is OpenAiCompatibleProvider => p !== null);
}

export function isRateLimitOrQuotaError(status: number, bodyText: string): boolean {
  const lower = bodyText.toLowerCase();
  return (
    status === 429 ||
    status === 402 ||
    lower.includes('rate_limit') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('quota') ||
    lower.includes('insufficient') ||
    lower.includes('余额') ||
    lower.includes('额度') ||
    lower.includes('限流') ||
    lower.includes('超限')
  );
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

const RAW_TEXT_SLICE = 40_000; // Cap input to protect the model's context window.

/**
 * Build the cleaner system prompt. When `maxOutputChars` is set, instruct the
 * model to keep the ENTIRE output (Front Matter + body) under that many
 * characters — used by the Worker, whose MAX_CONTENT_CHARS=5000 check would
 * otherwise reject the seed prompt's "3000 words" (~15-18K chars) output.
 * When omitted, retains the seed prompt's "≤3000 words" behavior.
 */
export function buildCleanerSystemPrompt(opts: { maxOutputChars?: number } = {}): string {
  const lengthRule = opts.maxOutputChars
    ? `- Keep the ENTIRE output (Front Matter + body) under ${opts.maxOutputChars} characters total.`
    : '- Maximum 3000 words in the body.';

  return `
You are a knowledge cleaning agent for the iRacing AI assistant's wiki.

## Goal
Convert raw web page or document text into a clean, well-structured Markdown
document with YAML Front Matter metadata.

## Output Format

The output MUST start with Front Matter delimited by "---":

---
title: <concise title, max 200 chars>
category: <one of: track-technique | car-setup | basics>
subcategory: <one of: driving-line | braking | tire-management | suspension | theory | presets | tools | getting-started | buying-guide | series-and-league | hardware>
tags: [tag1, tag2, tag3]
source_name: <optional, original website name>
source_url: <optional, original URL — OMIT entirely for file uploads with no source URL; do NOT emit an empty value>
season: <optional, e.g. 2025S3>
---

Then the body: a clean Markdown document with:
- A clear H1 title
- Logical H2/H3 heading hierarchy
- Clean paragraphs, no orphan lines
- Tables preserved in proper Markdown table syntax
- All advertising, navigation, cookie banners, and irrelevant content stripped
- Factual accuracy preserved — do NOT paraphrase technical values
- Image references converted to ![alt](url) placeholders where possible
- If the source is too noisy, output a brief explanation instead

## Category Guide
- track-technique: driving techniques, racing line, braking, tire management
- car-setup: car setup theory, preset guides, setup tools
- basics: getting started, buying guide, license system, hardware requirements

## Rules
- Write in the SAME LANGUAGE as the source content (English stays English)
- Keep technical terms, values, and units exactly as in the source
${lengthRule}
- Do NOT add content not present in the source
- Respond with ONLY the cleaned Markdown document, nothing else
`.trim();
}

/**
 * Build the user prompt: raw text (sliced to 40K) + optional source URL /
 * hint + optional reviewer feedback (the Worker's re-clean instructions JSON).
 */
export function makeCleanerUserPrompt(params: {
  rawText: string;
  sourceUrl?: string;
  hint?: string;
  feedback?: string;
}): string {
  let prompt = `Clean the following raw text into a structured Markdown document with Front Matter.`;
  if (params.sourceUrl) prompt += `\n\nSource URL: ${params.sourceUrl}`;
  if (params.hint) prompt += `\nContext hint: ${params.hint}`;
  prompt += `\n\n--- RAW TEXT START ---\n${params.rawText.slice(0, RAW_TEXT_SLICE)}\n--- RAW TEXT END ---\n`;
  prompt += `\nOutput ONLY the cleaned Markdown document (starting with "---" Front Matter). Nothing else.`;
  if (params.feedback && params.feedback.trim()) {
    prompt += `\n\n## Reviewer Feedback (incorporate these requirements into the cleaned output)\n${params.feedback.trim()}`;
  }
  return prompt;
}

// ---------------------------------------------------------------------------
// Single-provider HTTP call (with timeout + abort propagation)
// ---------------------------------------------------------------------------

async function callProvider(params: {
  provider: OpenAiCompatibleProvider;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  signal?: AbortSignal;
  timeoutMs: number;
}): Promise<string> {
  const endpoint = `${params.provider.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;

  // Combine the external signal (Worker 15min hardAbort) with a per-request
  // timeout so a hung connection doesn't dangle. Does not rely on
  // AbortSignal.any existing — wires the signals manually.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (params.signal) {
    if (params.signal.aborted) controller.abort();
    else params.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.provider.model,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userPrompt },
        ],
        temperature: 0.2,
        max_tokens: params.maxTokens,
      }),
      signal: controller.signal,
    });

    const bodyText = await response.text();

    if (!response.ok) {
      const stopOnRateLimit = process.env.STOP_ON_LLM_RATE_LIMIT !== 'false';
      if (stopOnRateLimit && isRateLimitOrQuotaError(response.status, bodyText)) {
        throw new StopCleaningError(
          `${params.provider.name} 返回限流/额度错误，已按配置停止本轮清洗。HTTP ${response.status}: ${bodyText.slice(0, 300)}`,
        );
      }
      throw new Error(`${params.provider.name} API failed: HTTP ${response.status}: ${bodyText.slice(0, 500)}`);
    }

    let json: any;
    try {
      json = JSON.parse(bodyText);
    } catch {
      throw new Error(`${params.provider.name} API returned non-JSON response: ${bodyText.slice(0, 200)}`);
    }

    const content = json?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      throw new Error(`${params.provider.name} API response missing choices[0].message.content`);
    }
    return content.trim();
  } finally {
    clearTimeout(timer);
    if (params.signal) params.signal.removeEventListener('abort', onExternalAbort);
  }
}

// ---------------------------------------------------------------------------
// Public: clean via LLM-direct (loops providers; NO Qoder fallback inside)
// ---------------------------------------------------------------------------

export interface CleanWithLlmDirectParams {
  rawText: string;
  sourceUrl?: string;
  hint?: string;
  feedback?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputChars?: number;
  maxTokens?: number;
}

/**
 * Clean raw text via the configured OpenAI-compatible LLM provider(s).
 *
 * Loops providers in order; returns the first success. On a rate-limit/quota
 * error (when STOP_ON_LLM_RATE_LIMIT !== 'false') throws `StopCleaningError`
 * immediately. On other errors, tries the next provider, then throws the last
 * error. Does NOT fall back to the Qoder SDK — the caller decides.
 */
export async function cleanWithLlmDirect(params: CleanWithLlmDirectParams): Promise<string> {
  const providers = getOpenAiCompatibleProviders();
  if (providers.length === 0) {
    throw new Error(
      'LLM 直连未配置：请设置 LLM_API_PROVIDERS 及对应 *_API_BASE_URL / *_API_KEY / *_MODEL',
    );
  }

  const systemPrompt = buildCleanerSystemPrompt({ maxOutputChars: params.maxOutputChars });
  const userPrompt = makeCleanerUserPrompt({
    rawText: params.rawText,
    sourceUrl: params.sourceUrl,
    hint: params.hint,
    feedback: params.feedback,
  });
  const maxTokens = params.maxTokens ?? 6000;
  const timeoutMs = params.timeoutMs ?? 120_000;

  let lastError: Error | null = null;
  for (const provider of providers) {
    console.log(
      `        LLM API: ${provider.name} / ${provider.model} (${provider.baseUrl}, key ${maskSecret(provider.apiKey)})`,
    );
    try {
      return await callProvider({ provider, systemPrompt, userPrompt, maxTokens, signal: params.signal, timeoutMs });
    } catch (err) {
      if (err instanceof StopCleaningError) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      console.log(`        LLM API 失败，尝试下一个 Provider: ${lastError.message}`);
    }
  }
  throw lastError ?? new Error('所有 LLM Provider 均失败');
}
