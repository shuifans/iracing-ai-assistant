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
import { JSON_SCHEMA, load as loadYaml } from 'js-yaml';

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
function parseYaml(yamlText: string): Record<string, unknown> {
  const parsed = loadYaml(yamlText, { schema: JSON_SCHEMA });
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Front Matter YAML must be an object');
  }
  const obj = parsed as Record<string, unknown>;
  // LLMs often emit empty YAML keys (e.g. "source_url:") which js-yaml
  // parses as null. Zod .optional() accepts undefined but not null, so strip
  // null-valued keys to make them equivalent to absent keys.
  for (const key of Object.keys(obj)) {
    if (obj[key] === null) delete obj[key];
  }
  return obj;
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
    throw new AppError(
      'DRAFT_INVALID',
      'Document does not start with Front Matter delimiter (---)',
    );
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
    raw = parseYaml(yamlBlock);
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

export function assertTrustedSourceMetadata(
  frontMatter: FrontMatterData,
  source: { id: string; sha256: string },
): void {
  if (
    frontMatter.id !== source.id ||
    frontMatter.source_id !== source.id ||
    frontMatter.source_sha256.toLowerCase() !== source.sha256.toLowerCase()
  ) {
    throw new AppError(
      'DRAFT_INVALID',
      'Trusted source metadata does not match the immutable source record',
    );
  }
}

/**
 * Generate a wiki file path from Front Matter metadata.
 *
 * Format: `{category}/{subcategory}/{slugified-title}.md`
 */
export function generateWikiPath(fm: {
  title: string;
  category: string;
  subcategory: string;
}): string {
  const slug = slugify(fm.title) || 'untitled';
  return `${fm.category}/${fm.subcategory}/${slug}.md`;
}
