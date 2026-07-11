import { describe, it, expect } from 'vitest';
import { generateId } from '@/lib/uuid';

describe('generateId', () => {
  it('returns a 36-character string', () => {
    const id = generateId();
    expect(id).toHaveLength(36);
  });

  it('matches UUID v7 format (version nibble = 7)', () => {
    const id = generateId();
    // UUID format: xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
    // The 15th character (index 14) should be '7'
    expect(id[14]).toBe('7');
  });

  it('generates unique values on consecutive calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId()));
    expect(ids.size).toBe(1000);
  });

  it('maintains lexicographic time ordering', () => {
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      ids.push(generateId());
    }
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });
});
