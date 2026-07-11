/**
 * Front Matter parser with Zod validation.
 *
 * Parses YAML Front Matter from Markdown documents, validates the extracted
 * metadata against the shared Zod schema, and provides wiki-path generation.
 *
 * @module knowledge/front-matter
 */

import { frontMatterSchema } from '@/modules/knowledge/schemas';
import type { FrontMatterData } from '@/modules/knowledge/types';
import { AppError } from '@/lib/errors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedDocument {
  frontMatter: FrontMatterData;
  body: string;
}

// ---------------------------------------------------------------------------
// YAML helpers (simple subset parser — no external dependency)
// ---------------------------------------------------------------------------

/**
 * Parse a simple YAML subset: flat key-value pairs with optional inline arrays
 * like `[a, b, c]`.  This is intentionally minimal — it only needs to handle
 * the Front Matter fields defined in `frontMatterSchema`.
 */
function parseSimpleYaml(yamlText: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const rawLine of yamlText.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();

    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      // Inline array: [tag1, tag2, tag3]
      const inner = rawValue.slice(1, -1);
      result[key] = inner
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } else if (rawValue === 'true' || rawValue === 'false') {
      result[key] = rawValue === 'true';
    } else if (/^\d+$/.test(rawValue)) {
      // Keep as string — Front Matter fields are strings
      result[key] = rawValue;
    } else {
      result[key] = rawValue;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Slug helper
// ---------------------------------------------------------------------------

/**
 * Convert a title string into a URL-safe slug.
 *
 * - Lowercases ASCII characters
 * - Replaces spaces with hyphens
 * - Removes special characters (keeps alphanumeric, hyphens, CJK chars)
 * - Collapses consecutive hyphens
 * - Trims leading/trailing hyphens
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-\u4e00-\u9fff\u3400-\u4dbf]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse Markdown text, extract Front Matter and body.
 *
 * @throws {AppError} `DRAFT_INVALID` when Front Matter is missing or malformed.
 */
export function parseFrontMatter(text: string): ParsedDocument {
  // Front Matter must start with `---` at the very beginning of the document.
  if (!text.startsWith('---')) {
    throw new AppError('DRAFT_INVALID', 'Document does not start with Front Matter delimiter (---)');
  }

  // Find the closing `---` — it can be `\n---\n`, `\n---` at EOF, or `\n---` followed by nothing.
  const afterOpen = text.indexOf('\n');
  if (afterOpen === -1) {
    throw new AppError('DRAFT_INVALID', 'Front Matter opening delimiter is incomplete');
  }

  // Search for closing delimiter: `\n---` after the opening line
  const closePattern = '\n---';
  const closeIdx = text.indexOf(closePattern, afterOpen + 1);
  if (closeIdx === -1) {
    throw new AppError('DRAFT_INVALID', 'Front Matter closing delimiter (---) not found');
  }

  const yamlBlock = text.slice(afterOpen + 1, closeIdx);

  // Body is everything after the closing `---\n` (or `---` at EOF)
  const afterClose = closeIdx + closePattern.length;
  const body = text.slice(afterClose).replace(/^\n/, ''); // strip one leading newline

  // Parse YAML block into a plain object
  let raw: Record<string, unknown>;
  try {
    raw = parseSimpleYaml(yamlBlock);
  } catch {
    throw new AppError('DRAFT_INVALID', 'Failed to parse Front Matter YAML');
  }

  // Validate through Zod schema (strips unknown keys via default .strip())
  const parsed = frontMatterSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.') || 'root';
      fieldErrors[path] = issue.message;
    }
    throw new AppError('DRAFT_INVALID', 'Front Matter validation failed', fieldErrors);
  }

  return {
    frontMatter: parsed.data as FrontMatterData,
    body,
  };
}

/**
 * Validate raw data against the Front Matter schema (no body extraction).
 *
 * @throws {AppError} `DRAFT_INVALID` on validation failure.
 */
export function validateFrontMatter(data: unknown): FrontMatterData {
  const parsed = frontMatterSchema.safeParse(data);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.') || 'root';
      fieldErrors[path] = issue.message;
    }
    throw new AppError('DRAFT_INVALID', 'Front Matter validation failed', fieldErrors);
  }
  return parsed.data as FrontMatterData;
}

/**
 * Generate a wiki file path from Front Matter metadata.
 *
 * Format: `{category}/{subcategory}/{slugified-title}.md`
 */
export function generateWikiPath(fm: FrontMatterData): string {
  const slug = slugify(fm.title) || 'untitled';
  return `${fm.category}/${fm.subcategory}/${slug}.md`;
}
