/**
 * Zod input schemas for the knowledge-evaluation API.
 *
 * @module knowledge-evaluation/schemas
 */

import { z } from 'zod';

export const submitFeedbackSchema = z.object({
  dimensionRatings: z.record(z.string(), z.number().int().min(0).max(100)).optional(),
  comments: z.string().max(2000).optional(),
  improvementInstructions: z.record(z.string(), z.unknown()).optional(),
});
export type SubmitFeedbackInput = z.infer<typeof submitFeedbackSchema>;

export const runEvaluationSchema = z
  .object({
    deep: z.boolean().optional(),
  })
  .optional();
export type RunEvaluationInput = z.infer<typeof runEvaluationSchema>;

export const reCleanTriggerSchema = z
  .object({
    /** Optional: only fold these feedback entries into the re-clean instructions. */
    feedbackIds: z.array(z.string()).optional(),
  })
  .optional();
export type ReCleanTriggerInput = z.infer<typeof reCleanTriggerSchema>;
