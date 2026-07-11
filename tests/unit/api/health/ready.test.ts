import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks must be declared before imports that use them
vi.mock('@/config/env', () => ({
  env: {
    QODER_PERSONAL_ACCESS_TOKEN: 'test-pat',
    WIKI_ROOT: '/data/md-wiki',
  },
}));

vi.mock('fs', () => ({
  default: {
    accessSync: vi.fn(),
    constants: { R_OK: 4 },
  },
}));

vi.mock('@/db/client', () => ({
  getDb: vi.fn(),
}));

// Import after mocks
import { GET } from '@/app/api/health/ready/route';
import { env } from '@/config/env';
import fs from 'fs';
import { getDb } from '@/db/client';

describe('GET /api/health/ready', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (env as any).QODER_PERSONAL_ACCESS_TOKEN = 'test-pat';
    (env as any).WIKI_ROOT = '/data/md-wiki';
    vi.mocked(fs.accessSync).mockReturnValue(undefined);
    vi.mocked(getDb).mockReturnValue({
      run: vi.fn(),
    } as any);
  });

  it('returns 200 ready when all checks pass', async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('ready');
    expect(body.checks.pat).toBe(true);
    expect(body.checks.wiki).toBe(true);
    expect(body.checks.database).toBe(true);
  });

  it('returns 503 not_ready when PAT is not configured', async () => {
    (env as any).QODER_PERSONAL_ACCESS_TOKEN = '';

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe('not_ready');
    expect(body.checks.pat).toBe(false);
  });

  it('returns 503 not_ready when Wiki is not readable', async () => {
    vi.mocked(fs.accessSync).mockImplementation(() => {
      throw new Error('EACCES');
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe('not_ready');
    expect(body.checks.wiki).toBe(false);
  });

  it('returns 503 not_ready when database connection fails', async () => {
    vi.mocked(getDb).mockImplementation(() => {
      throw new Error('DB connection failed');
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe('not_ready');
    expect(body.checks.database).toBe(false);
  });
});
