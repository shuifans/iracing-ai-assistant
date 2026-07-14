import { z } from 'zod';
import { KNOWLEDGE_CATEGORIES } from '@/config/constants';

// ---------------------------------------------------------------------------
// Category enum (derived from constants)
// ---------------------------------------------------------------------------

const categoryKeys = Object.keys(KNOWLEDGE_CATEGORIES) as [
  keyof typeof KNOWLEDGE_CATEGORIES,
  ...Array<keyof typeof KNOWLEDGE_CATEGORIES>,
];

// ---------------------------------------------------------------------------
// URL submission
// ---------------------------------------------------------------------------

export const submitUrlSchema = z.object({
  url: z.string().url().startsWith('https://', 'Only HTTPS URLs are allowed'),
  title: z.string().min(1).max(200).optional(),
});

export type SubmitUrlInput = z.infer<typeof submitUrlSchema>;

// ---------------------------------------------------------------------------
// Front Matter — validates Agent cleaning output
// ---------------------------------------------------------------------------

export const frontMatterSchema = z.object({
  title: z.string().min(1).max(200),
  category: z.enum(categoryKeys),
  subcategory: z.string().min(1).max(100),
  tags: z.array(z.string().min(1).max(50)).min(1).max(10),
  source_name: z.string().max(200).optional(),
  source_url: z.string().url().optional(),
  season: z.string().max(20).optional(),
  updated_at: z.string().optional(),
});

export type FrontMatterInput = z.infer<typeof frontMatterSchema>;

// ---------------------------------------------------------------------------
// Draft editing
// ---------------------------------------------------------------------------

export const editDraftSchema = z.object({
  content: z.string().min(1),
});

export type EditDraftInput = z.infer<typeof editDraftSchema>;

// ---------------------------------------------------------------------------
// Allowed MIME types for file upload
// ---------------------------------------------------------------------------

export const ALLOWED_KNOWLEDGE_MIMES = [
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

// ---------------------------------------------------------------------------
// Cursor-based pagination
// ---------------------------------------------------------------------------

export const cursorPageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type CursorPageInput = z.infer<typeof cursorPageSchema>;
