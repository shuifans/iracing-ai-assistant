/**
 * Two-tier chat cache (L1 in-process LRU + L2 SQLite).
 *
 * Caches (a) full answers (query+history hash → answer+sources+grounding) and
 * (b) retrieval results (query hash → Evidence[]). Hit path is <1ms (L1) /
 * <5ms (L2), skipping the BM25 search and the LLM call entirely.
 *
 * Key = sha256(normalize(query) + historyHash) where historyHash = recent
 * message ids — so multi-turn contexts with the same wording still differ.
 *
 * @module chat/cache
 */

import { createHash } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import { eq, and, lt } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { retrievalCache } from '@/db/schema/cache';
import { utcNow } from '@/lib/datetime';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CacheType = 'answer' | 'retrieval';

export interface AnswerPayload {
  content: string;
  sources: Array<{
    sourceType: string;
    title: string;
    url?: string | null;
    wikiPath?: string | null;
    excerpt?: string | null;
    season?: string | null;
  }>;
  grounding: 'grounded' | 'inferred' | 'insufficient';
}

export interface RetrievalPayload {
  chunks: Array<{
    evidenceId: string;
    title: string;
    wikiPath: string;
    excerpt: string;
    season?: string;
    score: number;
  }>;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const L1_MAX = 200;
const L1_TTL_MS = 5 * 60_000; // 5 min
const L2_TTL_MS = 24 * 60 * 60_000; // 24h
const HISTORY_DEPTH = 3; // last N message ids in the hash

// L1: string (JSON payload) keyed by cache key, per type
const l1Answer = new LRUCache<string, string>({ max: L1_MAX, ttl: L1_TTL_MS });
const l1Retrieval = new LRUCache<string, string>({ max: L1_MAX, ttl: L1_TTL_MS });

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

/** Normalize a query: lowercase, collapse whitespace, strip punctuation edges. */
function normalizeQuery(q: string): string {
  return q
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^[，。？！,.?!]+|[，。？！,.?!]+$/g, '');
}

/**
 * Build a cache key from the query + a history hash.
 * historyIds = the most recent N completed message ids (user+assistant),
 * so the same question in a different conversational context misses.
 */
export function makeCacheKey(query: string, historyIds: string[] = []): string {
  const norm = normalizeQuery(query);
  const hist = (historyIds.slice(-HISTORY_DEPTH).join('|')) || 'no-history';
  return createHash('sha256').update(`${norm}::${hist}`).digest('hex');
}

// ---------------------------------------------------------------------------
// L2 (SQLite) operations
// ---------------------------------------------------------------------------

function l2Get(key: string, type: CacheType): string | null {
  try {
    const db = getDb();
    const now = utcNow();
    const rows = db
      .select()
      .from(retrievalCache)
      .where(and(eq(retrievalCache.cacheKey, key), eq(retrievalCache.cacheType, type)))
      .limit(1)
      .all();
    const row = rows[0];
    if (!row) return null;
    if (row.expiresAt <= now) return null; // expired
    // bump hit count (fire-and-forget)
    db.update(retrievalCache)
      .set({ hitCount: row.hitCount + 1 })
      .where(eq(retrievalCache.cacheKey, key))
      .run();
    return row.payloadJson;
  } catch {
    return null;
  }
}

function l2Set(key: string, type: CacheType, query: string, payloadJson: string, ttlMs: number): void {
  try {
    const db = getDb();
    const now = utcNow();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    db.transaction(() => {
      const existing = db
        .select()
        .from(retrievalCache)
        .where(eq(retrievalCache.cacheKey, key))
        .limit(1)
        .all();
      if (existing[0]) {
        db.update(retrievalCache)
          .set({ payloadJson, expiresAt, query, hitCount: existing[0]!.hitCount, createdAt: now })
          .where(eq(retrievalCache.cacheKey, key))
          .run();
      } else {
        db.insert(retrievalCache)
          .values({ cacheKey: key, cacheType: type, query, payloadJson, expiresAt, hitCount: 0, createdAt: now })
          .run();
      }
    });
  } catch {
    // cache write failure is non-fatal
  }
}

/** Evict expired entries (call periodically, e.g. on each chat request or a cron). */
export function evictExpiredCache(): number {
  try {
    const now = utcNow();
    const db = getDb();
    const r = db.delete(retrievalCache).where(lt(retrievalCache.expiresAt, now)).run();
    return r.changes ?? 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getCachedAnswer(key: string): AnswerPayload | null {
  const l1 = l1Answer.get(key);
  if (l1) {
    try { return JSON.parse(l1) as AnswerPayload; } catch { /* ignore */ }
  }
  const l2 = l2Get(key, 'answer');
  if (l2) {
    l1Answer.set(key, l2); // promote to L1
    try { return JSON.parse(l2) as AnswerPayload; } catch { /* ignore */ }
  }
  return null;
}

export function setCachedAnswer(key: string, query: string, payload: AnswerPayload): void {
  const json = JSON.stringify(payload);
  l1Answer.set(key, json);
  l2Set(key, 'answer', query, json, L2_TTL_MS);
}

export function getCachedRetrieval(key: string): RetrievalPayload | null {
  const l1 = l1Retrieval.get(key);
  if (l1) {
    try { return JSON.parse(l1) as RetrievalPayload; } catch { /* ignore */ }
  }
  const l2 = l2Get(key, 'retrieval');
  if (l2) {
    l1Retrieval.set(key, l2);
    try { return JSON.parse(l2) as RetrievalPayload; } catch { /* ignore */ }
  }
  return null;
}

export function setCachedRetrieval(key: string, query: string, payload: RetrievalPayload): void {
  const json = JSON.stringify(payload);
  l1Retrieval.set(key, json);
  l2Set(key, 'retrieval', query, json, L2_TTL_MS);
}
