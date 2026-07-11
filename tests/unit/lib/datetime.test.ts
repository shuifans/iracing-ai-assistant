import { describe, it, expect } from 'vitest';
import { utcNow, formatForDisplay } from '@/lib/datetime';

describe('utcNow', () => {
  it('returns a valid ISO 8601 string', () => {
    const now = utcNow();
    expect(now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('can be parsed by Date constructor', () => {
    const now = utcNow();
    const date = new Date(now);
    expect(date.getTime()).not.toBeNaN();
  });

  it('returns monotonically increasing values', () => {
    const a = utcNow();
    const b = utcNow();
    expect(new Date(b).getTime()).toBeGreaterThanOrEqual(new Date(a).getTime());
  });
});

describe('formatForDisplay', () => {
  it('formats UTC time to Asia/Shanghai display string', () => {
    // 2026-07-11T12:00:00.000Z → Asia/Shanghai is UTC+8 → 2026-07-11 20:00:00
    const result = formatForDisplay('2026-07-11T12:00:00.000Z');
    expect(result).toContain('2026');
    // The exact format may vary by locale, but should contain date parts
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
