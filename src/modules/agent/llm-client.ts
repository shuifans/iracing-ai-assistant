/**
 * OpenAI-compatible LLM direct streaming client.
 *
 * Bypasses the Qoder SDK agent loop (the 80% orchestration overhead measured
 * in eval-report.md) for the local-answer fast path. Streams SSE text deltas
 * and the final usage (token) telemetry.
 *
 * Endpoint / API key / model are env-driven so the chat LLM can be swapped
 * (LongCat-2.0 → Qwen DashScope → OpenAI → …) by editing `.env` + restart,
 * without code changes. Reads `LLM_*` first and falls back to the project's
 * existing `LONGCAT_*` vars (shared with the knowledge-cleaning path) so a
 * deployment that only sets `LONGCAT_*` keeps working unchanged.
 *
 * @module agent/llm-client
 */

import type { Evidence } from './types';

// ---------------------------------------------------------------------------
// Config (read directly — these vars are not in the validated env schema;
// reading process.env avoids triggering full schema validation in tests/builds)
// ---------------------------------------------------------------------------

function baseUrl(): string {
  return (process.env.LLM_API_BASE_URL ?? process.env.LONGCAT_API_BASE_URL ?? '').replace(/\/$/, '');
}
function apiKey(): string {
  return process.env.LLM_API_KEY ?? process.env.LONGCAT_API_KEY ?? '';
}
function model(): string {
  return process.env.LLM_MODEL ?? process.env.LONGCAT_MODEL ?? 'LongCat-2.0';
}

export function isLlmDirectConfigured(): boolean {
  return !!(baseUrl() && apiKey());
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmChatChunk {
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface StreamLlmDirectParams {
  systemPrompt: string;
  evidence: Evidence[];
  history: LlmChatMessage[];
  userMessage: string;
  signal: AbortSignal;
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

/** Build the OpenAI messages array with retrieved evidence + history + user. */
export function buildMessages(params: {
  systemPrompt: string;
  evidence: Evidence[];
  history: LlmChatMessage[];
  userMessage: string;
}): LlmChatMessage[] {
  const evidenceBlock =
    params.evidence.length === 0
      ? ''
      : '\n\n## Retrieved Wiki Context (local BM25 search)\n' +
        params.evidence
          .map(
            (e) =>
              `- **${e.title}** (${e.wikiPath})\n  ${e.excerpt}`,
          )
          .join('\n');

  const system: LlmChatMessage = {
    role: 'system',
    content: params.systemPrompt + evidenceBlock,
  };
  return [system, ...params.history, { role: 'user', content: params.userMessage }];
}

// ---------------------------------------------------------------------------
// Streaming client
// ---------------------------------------------------------------------------

/**
 * Stream a chat completion from the configured OpenAI-compatible LLM endpoint.
 * Yields {text} deltas as they arrive, and a final {usage} chunk (from
 * stream_options.include_usage).
 *
 * Throws on non-2xx, network error, or abort.
 */
export async function* streamLlmDirect(
  params: StreamLlmDirectParams,
): AsyncGenerator<LlmChatChunk> {
  const endpoint = `${baseUrl()}/v1/chat/completions`;
  const messages = buildMessages(params);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model(),
      messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.3,
      max_tokens: 1000,
    }),
    signal: params.signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new Error(`LongCat API failed: HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage: { inputTokens: number; outputTokens: number } | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const json = JSON.parse(data);
          // Text delta
          const delta = json?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta) {
            yield { text: delta };
          }
          // Usage (sent in a final chunk with stream_options.include_usage)
          const u = json?.usage;
          if (u && typeof u === 'object') {
            usage = {
              inputTokens: u.prompt_tokens ?? u.input_tokens ?? 0,
              outputTokens: u.completion_tokens ?? u.output_tokens ?? 0,
            };
          }
        } catch {
          // Skip malformed chunk
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (usage) yield { text: '', usage };
}
