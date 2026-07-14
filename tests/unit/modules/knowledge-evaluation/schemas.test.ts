import { describe, it, expect } from 'vitest';
import {
  submitFeedbackSchema,
  runEvaluationSchema,
  reCleanTriggerSchema,
} from '@/modules/knowledge-evaluation/schemas';

describe('submitFeedbackSchema', () => {
  it('parses valid feedback', () => {
    const r = submitFeedbackSchema.safeParse({
      dimensionRatings: { accuracy: 80, clarity: 70 },
      comments: 'needs more detail',
      improvementInstructions: { add: 'telemetry examples' },
    });
    expect(r.success).toBe(true);
  });

  it('parses empty object (all fields optional)', () => {
    expect(submitFeedbackSchema.safeParse({}).success).toBe(true);
  });

  it('rejects rating > 100', () => {
    expect(
      submitFeedbackSchema.safeParse({ dimensionRatings: { accuracy: 150 } }).success,
    ).toBe(false);
  });

  it('rejects rating < 0', () => {
    expect(
      submitFeedbackSchema.safeParse({ dimensionRatings: { accuracy: -1 } }).success,
    ).toBe(false);
  });

  it('rejects comments > 2000 chars', () => {
    expect(submitFeedbackSchema.safeParse({ comments: 'x'.repeat(2001) }).success).toBe(false);
  });
});

describe('runEvaluationSchema', () => {
  it('parses { deep: true }', () => {
    expect(runEvaluationSchema.safeParse({ deep: true }).success).toBe(true);
  });

  it('parses undefined (optional whole body)', () => {
    expect(runEvaluationSchema.safeParse(undefined).success).toBe(true);
  });
});

describe('reCleanTriggerSchema', () => {
  it('parses { feedbackIds: [...] }', () => {
    expect(reCleanTriggerSchema.safeParse({ feedbackIds: ['a', 'b'] }).success).toBe(true);
  });

  it('parses undefined', () => {
    expect(reCleanTriggerSchema.safeParse(undefined).success).toBe(true);
  });
});
