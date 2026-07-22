import { describe, it, expect } from 'vitest';
import { VALID_TRANSITIONS } from '@/modules/jobs/types';
import { JOB_STATUSES } from '@/config/constants';

const validStatuses = new Set<string>(JOB_STATUSES);

describe('VALID_TRANSITIONS', () => {
  it('contains exactly 16 transitions', () => {
    expect(VALID_TRANSITIONS).toHaveLength(16);
  });

  it('every transition uses a valid JOB_STATUSES value for "from" and "to"', () => {
    for (const t of VALID_TRANSITIONS) {
      expect(validStatuses.has(t.from)).toBe(true);
      expect(validStatuses.has(t.to)).toBe(true);
    }
  });

  it('every transition has distinct from/to (no self-loops)', () => {
    for (const t of VALID_TRANSITIONS) {
      expect(t.from).not.toBe(t.to);
    }
  });

  it('includes the happy-path pipeline: queued → extracting → cleaning → pending_review → approved → publishing → published', () => {
    const has = (from: string, to: string) =>
      VALID_TRANSITIONS.some((t) => t.from === from && t.to === to);

    expect(has('queued', 'extracting')).toBe(true);
    expect(has('extracting', 'cleaning')).toBe(true);
    expect(has('cleaning', 'pending_review')).toBe(true);
    expect(has('pending_review', 'approved')).toBe(true);
    expect(has('approved', 'publishing')).toBe(true);
    expect(has('publishing', 'published')).toBe(true);
  });

  it('includes pause/resume transitions: queued ⇄ paused, paused → cancelled', () => {
    expect(VALID_TRANSITIONS).toContainEqual({ from: 'queued', to: 'paused' });
    expect(VALID_TRANSITIONS).toContainEqual({ from: 'paused', to: 'queued' });
    expect(VALID_TRANSITIONS).toContainEqual({ from: 'paused', to: 'cancelled' });
  });

  it('includes unapprove transition: approved → pending_review', () => {
    expect(VALID_TRANSITIONS).toContainEqual({ from: 'approved', to: 'pending_review' });
  });

  it('includes failure transitions for extracting, cleaning and publishing', () => {
    const has = (from: string, to: string) =>
      VALID_TRANSITIONS.some((t) => t.from === from && t.to === to);

    expect(has('extracting', 'failed')).toBe(true);
    expect(has('cleaning', 'failed')).toBe(true);
    expect(has('publishing', 'failed')).toBe(true);
  });

  it('includes retry transition: failed → queued', () => {
    expect(VALID_TRANSITIONS).toContainEqual({ from: 'failed', to: 'queued' });
  });

  it('includes cancel transition: queued → cancelled', () => {
    expect(VALID_TRANSITIONS).toContainEqual({ from: 'queued', to: 'cancelled' });
  });

  it('includes rejection transition: pending_review → rejected', () => {
    expect(VALID_TRANSITIONS).toContainEqual({ from: 'pending_review', to: 'rejected' });
  });

  it('does not allow transitioning out of terminal states (published, rejected, cancelled)', () => {
    const terminalStates = ['published', 'rejected', 'cancelled'];
    for (const t of VALID_TRANSITIONS) {
      expect(terminalStates).not.toContain(t.from);
    }
  });
});
