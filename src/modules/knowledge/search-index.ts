/**
 * Local BM25 search index over the md-wiki.
 *
 * Replaces the slow `wiki-search` LLM sub-agent (100-300s) with instant
 * keyword retrieval (~ms, no LLM). Chunks each wiki .md by H2/H3 headings,
 * builds a minisearch BM25 index, persists to JSON, and exposes `searchWiki()`
 * returning the existing `Evidence` contract.
 *
 * @module knowledge/search-index
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import MiniSearch from 'minisearch';
import { parseFrontMatter } from '@/modules/knowledge/front-matter';
import { generateId } from '@/lib/uuid';
import { utcNow } from '@/lib/datetime';
import type { Evidence } from '@/modules/agent/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WikiChunk {
  id: string;
  title: string;
  wikiPath: string;
  category: string;
  tags: string;
  heading: string;
  text: string;
  season?: string;
}

export interface SearchResult extends Evidence {
  /** BM25 score (higher = more relevant) */
  score: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATA_ROOT = process.env.DATA_ROOT ?? path.join(process.cwd(), 'data');
const WIKI_ROOT = process.env.WIKI_ROOT ?? path.join(DATA_ROOT, 'md-wiki');
const INDEX_PATH = path.join(DATA_ROOT, 'search-index.json');
const MAX_CHUNK_CHARS = 600;
const SEARCH_FIELDS = ['text', 'title', 'tags', 'heading'];

/** Shared index options (used for build + loadJSON). */
const INDEX_OPTIONS = {
  fields: SEARCH_FIELDS,
  storeFields: ['title', 'wikiPath', 'category', 'tags', 'heading', 'text', 'season'],
  tokenize,
  searchOptions: {
    boost: { title: 3, heading: 2, tags: 2, text: 1 },
    prefix: true,
    fuzzy: 0.2,
    combineWith: 'OR' as const,
  },
};

// ---------------------------------------------------------------------------
// File walking + chunking
// ---------------------------------------------------------------------------

/** Recursively collect all `.md` file paths under dir (excludes index.md). */
function collectMdFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry).replace(/\\/g, '/');
    const stat = fs.statSync(full);
    if (stat.isDirectory()) results.push(...collectMdFiles(full));
    else if (
      stat.isFile() &&
      entry.endsWith('.md') &&
      entry !== 'index.md' &&
      entry !== 'KNOWLEDGE.md'
    ) {
      results.push(full);
    }
  }
  return results;
}

/** Split body into chunks by H2/H3 headings, then by size. */
function chunkBody(body: string, maxChars: number): { heading: string; text: string }[] {
  const lines = body.split('\n');
  const chunks: { heading: string; text: string }[] = [];
  let currentHeading = '';
  let buf: string[] = [];

  const flush = () => {
    const text = buf.join('\n').trim();
    if (!text) return;
    // Sub-chunk oversized paragraphs
    if (text.length > maxChars) {
      for (let i = 0; i < text.length; i += maxChars) {
        chunks.push({ heading: currentHeading, text: text.slice(i, i + maxChars) });
      }
    } else {
      chunks.push({ heading: currentHeading, text });
    }
    buf = [];
  };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.*)/);
    const h3 = line.match(/^###\s+(.*)/);
    if (h2 || h3) {
      flush();
      currentHeading = ((h2 ? h2[1] : h3 ? h3[1] : '') ?? '').trim();
    } else {
      buf.push(line);
    }
  }
  flush();
  return chunks;
}

/** Read + chunk one wiki file into WikiChunk[]. */
function chunkFile(filePath: string, wikiRoot: string): WikiChunk[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content.startsWith('---')) return [];
  let parsed: { frontMatter: any; body: string };
  try {
    parsed = parseFrontMatter(content);
  } catch {
    return [];
  }
  const fm = parsed.frontMatter;
  const wikiPath = path.relative(wikiRoot, filePath).replace(/\\/g, '/');
  const base = {
    title: String(fm.title ?? path.basename(filePath, '.md')),
    wikiPath,
    category: String(fm.category ?? ''),
    tags: Array.isArray(fm.tags) ? fm.tags.join(', ') : '',
    season: fm.season ? String(fm.season) : undefined,
  };
  return chunkBody(parsed.body, MAX_CHUNK_CHARS).map((c) => ({
    id: generateId(),
    ...base,
    heading: c.heading,
    text: c.text,
  }));
}

// ---------------------------------------------------------------------------
// Tokenizer (CJK-aware: bigrams for Chinese, default for ASCII)
// ---------------------------------------------------------------------------

/**
 * Tokenize for BM25. ASCII splits on non-alphanumerics; CJK runs produce
 * bigrams (2-char sliding window) + unigrams so Chinese queries match
 * English-mixed wiki content (most wiki is English; queries are often
 * Chinese with embedded English terms like "iRating", "Safety Rating").
 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();
  // Regex: capture ASCII word runs OR CJK char runs
  const re = /[a-z0-9]+|[一-鿿㐀-䶿]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower)) !== null) {
    const tok = m[0];
    if (/[a-z0-9]/.test(tok)) {
      tokens.push(tok);
    } else {
      // CJK run → bigrams + unigrams
      for (let i = 0; i < tok.length; i++) {
        tokens.push(tok[i]!);
        if (i + 1 < tok.length) tokens.push(tok.slice(i, i + 2));
      }
    }
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Index build / load
// ---------------------------------------------------------------------------

function buildIndex(wikiRoot: string): MiniSearch {
  const files = collectMdFiles(wikiRoot);
  const allChunks: WikiChunk[] = [];
  for (const f of files) allChunks.push(...chunkFile(f, wikiRoot));

  const ms = new MiniSearch(INDEX_OPTIONS);
  ms.addAll(allChunks);
  return ms;
}

let _index: MiniSearch | null = null;
let _indexMtimeMs = -1;

function loadPersistedIndex(): MiniSearch {
  const json = fs.readFileSync(INDEX_PATH, 'utf-8');
  const index = MiniSearch.loadJSON(json, INDEX_OPTIONS);
  _indexMtimeMs = fs.statSync(INDEX_PATH).mtimeMs;
  return index;
}

/** Lazily load (or build + persist) the search index singleton. */
function getIndex(): MiniSearch {
  if (_index) {
    try {
      if (fs.statSync(INDEX_PATH).mtimeMs !== _indexMtimeMs) {
        _index = loadPersistedIndex();
      }
    } catch {
      _index = null;
      _indexMtimeMs = -1;
    }
    if (_index) return _index;
  }
  try {
    _index = loadPersistedIndex();
    return _index;
  } catch {
    // Not built yet — build in-memory from WIKI_ROOT
    _index = buildIndex(WIKI_ROOT);
    try {
      fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true });
      fs.writeFileSync(INDEX_PATH, JSON.stringify(_index));
      _indexMtimeMs = fs.statSync(INDEX_PATH).mtimeMs;
    } catch {
      // persist failure is non-fatal (in-memory still works)
    }
    return _index;
  }
}

/** Rebuild + persist the index (called by build-search-index script). */
export function rebuildAndPersist(wikiRoot = WIKI_ROOT): { files: number; chunks: number } {
  const ms = buildIndex(wikiRoot);
  fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(ms));
  _indexMtimeMs = fs.statSync(INDEX_PATH).mtimeMs;
  _index = ms;
  const files = collectMdFiles(wikiRoot).length;
  return { files, chunks: (ms as any)._documentCount ?? 0 };
}

// ---------------------------------------------------------------------------
// Public search API
// ---------------------------------------------------------------------------

/**
 * Search the local wiki by BM25. Returns Evidence[] (with score).
 * No LLM call — instant.
 */
export function searchWiki(query: string, topK = 5): SearchResult[] {
  if (!query.trim()) return [];
  const ms = getIndex();
  const results = ms.search(query).slice(0, topK);
  const retrievedAt = utcNow();
  return results.map((r: any) => {
    const excerpt = String(r.text ?? '').slice(0, 600);
    return {
      evidenceId: r.id ?? generateId(),
      type: 'wiki' as const,
      title: String(r.heading || r.title || ''),
      wikiPath: String(r.wikiPath ?? ''),
      excerpt,
      season: r.season ? String(r.season) : undefined,
      retrievedAt,
      score: r.score,
    };
  });
}

/** Top BM25 score for a query — used to decide web-fallback threshold. */
export function topSearchScore(query: string): number {
  const r = searchWiki(query, 1);
  return r.length ? r[0]!.score : 0;
}
