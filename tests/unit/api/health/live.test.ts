import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/db/client', () => ({
  getRawDb: vi.fn(),
}));

import { GET } from '@/app/api/health/live/route';
import { getRawDb } from '@/db/client';

describe('GET /api/health/live', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRawDb).mockReturnValue({
      exec: vi.fn(),
    } as any);
  });

  it('returns 200 ok when database is healthy', async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
  });

  it('returns 503 when database is unreachable', async () => {
    vi.mocked(getRawDb).mockImplementation(() => {
      throw new Error('DB unreachable');
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe('error');
  });
});
