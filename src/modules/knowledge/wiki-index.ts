/**
 * Deterministic wiki index builder.
 *
 * Scans the wiki root directory, collects all `.md` files with valid Front
 * Matter, and generates a sorted `index.md`.
 *
 * @module knowledge/wiki-index
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseFrontMatter } from '@/modules/knowledge/front-matter';
import { KNOWLEDGE_CATEGORIES } from '@/config/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IndexEntry {
  title: string;
  category: string;
  subcategory: string;
  wikiPath: string;
  tags: string[];
  season?: string;
}

// ---------------------------------------------------------------------------
// Category ordering (from KNOWLEDGE_CATEGORIES enum definition order)
// ---------------------------------------------------------------------------

const CATEGORY_ORDER: string[] = Object.keys(KNOWLEDGE_CATEGORIES);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect all `.md` file paths under `dir`.
 */
function collectMdFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry).replace(/\\/g, '/');
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...collectMdFiles(fullPath));
    } else if (stat.isFile() && entry.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Try to parse a file and return an IndexEntry, or null on failure.
 */
function tryParseEntry(filePath: string, wikiRoot: string): IndexEntry | null {
  const content = fs.readFileSync(filePath, 'utf-8');

  // Skip files that don't start with Front Matter delimiter
  if (!content.startsWith('---')) return null;

  try {
    const { frontMatter } = parseFrontMatter(content);
    const relativePath = path.relative(wikiRoot, filePath).replace(/\\/g, '/');
    return {
      title: frontMatter.title,
      category: frontMatter.category,
      subcategory: frontMatter.subcategory,
      wikiPath: relativePath,
      tags: frontMatter.tags,
      season: frontMatter.season,
    };
  } catch (err) {
    console.warn(`[wiki-index] Skipping ${filePath}: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Sort entries deterministically:
 * 1. category — enum definition order
 * 2. subcategory — alphabetical
 * 3. title — alphabetical
 */
function sortEntries(entries: IndexEntry[]): IndexEntry[] {
  return entries.sort((a, b) => {
    const catA = CATEGORY_ORDER.indexOf(a.category);
    const catB = CATEGORY_ORDER.indexOf(b.category);
    // Unknown categories go to the end
    const catOrder =
      (catA === -1 ? CATEGORY_ORDER.length : catA) -
      (catB === -1 ? CATEGORY_ORDER.length : catB);
    if (catOrder !== 0) return catOrder;

    const subOrder = a.subcategory.localeCompare(b.subcategory);
    if (subOrder !== 0) return subOrder;

    return a.title.localeCompare(b.title);
  });
}

/**
 * Render sorted entries into index.md Markdown content.
 */
function renderIndex(entries: IndexEntry[]): string {
  const lines: string[] = ['# Knowledge Index'];

  let currentCategory: string | null = null;
  let currentSubcategory: string | null = null;

  for (const entry of entries) {
    if (entry.category !== currentCategory) {
      lines.push('');
      lines.push(`## ${entry.category}`);
      currentCategory = entry.category;
      currentSubcategory = null;
    }

    if (entry.subcategory !== currentSubcategory) {
      lines.push('');
      lines.push(`### ${entry.subcategory}`);
      currentSubcategory = entry.subcategory;
    }

    const tagPart = entry.tags.length > 0 ? ` — Tags: ${entry.tags.join(', ')}` : '';
    lines.push(`- [${entry.title}](${entry.wikiPath})${tagPart}`);
  }

  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan the wiki directory, collect all `.md` files (excluding `index.md`),
 * parse their Front Matter, and return the entry list (unsorted).
 *
 * Shared by `rebuildIndex` (for index.md generation) and the evaluation
 * dedup / retrieval-probe layers (which need the in-memory entry list
 * without re-walking the wiki).
 */
export function collectIndexEntries(wikiRoot: string): IndexEntry[] {
  const normalizedRoot = wikiRoot.replace(/\\/g, '/');
  const allFiles = collectMdFiles(normalizedRoot);

  // Exclude index.md itself
  const indexFileName = 'index.md';
  const filtered = allFiles.filter((f) => {
    const relative = path.relative(normalizedRoot, f).replace(/\\/g, '/');
    return relative !== indexFileName;
  });

  const entries: IndexEntry[] = [];
  for (const file of filtered) {
    const entry = tryParseEntry(file, normalizedRoot);
    if (entry) entries.push(entry);
  }
  return entries;
}

/**
 * Scan the wiki directory and generate a deterministic `index.md` string.
 */
export function rebuildIndex(wikiRoot: string): string {
  const entries = collectIndexEntries(wikiRoot);
  const sorted = sortEntries(entries);
  return renderIndex(sorted);
}

/**
 * Write the generated index.md content to disk.
 */
export function writeIndex(wikiRoot: string, content: string): void {
  const indexPath = path.join(wikiRoot, 'index.md');
  fs.writeFileSync(indexPath, content, 'utf-8');
}
