import { z } from 'zod';
import { KNOWLEDGE_CATEGORIES } from '@/config/constants';

// ---------------------------------------------------------------------------
// Category enum (derived from constants)
// ---------------------------------------------------------------------------

const categoryKeys = Object.keys(KNOWLEDGE_CATEGORIES) as [
  keyof typeof KNOWLEDGE_CATEGORIES,
  ...Array<keyof typeof KNOWLEDGE_CATEGORIES>,
];

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day!));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month! - 1 &&
      date.getUTCDate() === day
    );
  }, 'Invalid calendar date');

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

export const frontMatterSchema = z
  .object({
    id: z.string().min(1).max(200),
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(300),
    category: z.enum(categoryKeys),
    subcategory: z.string().min(1).max(100),
    tags: z.array(z.string().min(1).max(50)).min(1).max(10),
    aliases: z.array(z.string().min(1).max(100)).max(10).default([]),
    source_id: z.string().min(1).max(200),
    source_name: z.string().max(200).optional(),
    source_url: z.string().url().optional(),
    source_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    content_type: z
      .enum([
        'schedule',
        'sporting-rule',
        'series-guide',
        'beginner-guide',
        'driving-guide',
        'setup-guide',
        'car-reference',
        'track-reference',
        'hardware-guide',
        'software-guide',
        'other',
      ])
      .optional(),
    season: z.string().max(20).optional(),
    effective_date: isoDateSchema.optional(),
    expires_at: isoDateSchema.optional(),
    updated_at: isoDateSchema.optional(),
  })
  .superRefine((data, ctx) => {
    const allowed = KNOWLEDGE_CATEGORIES[data.category] as readonly string[];
    if (!allowed.includes(data.subcategory)) {
      ctx.addIssue({
        code: 'custom',
        path: ['subcategory'],
        message: `Subcategory '${data.subcategory}' is not valid for '${data.category}'`,
      });
    }
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
