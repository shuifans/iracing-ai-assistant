import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/modules/auth/token-service', () => ({ verifyAccessToken: vi.fn() }));
vi.mock('@/modules/knowledge/service', () => ({ retryGitSync: vi.fn() }));
vi.mock('@/modules/audit/service', () => ({ recordAudit: vi.fn() }));

import { verifyAccessToken } from '@/modules/auth/token-service';
import { retryGitSync } from '@/modules/knowledge/service';
import { POST } from '@/app/api/knowledge/git/retry/route';

describe('POST /api/knowledge/git/retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAccessToken).mockResolvedValue({
      id: 'admin-1',
      role: 'knowledge_admin',
      status: 'active',
    } as any);
  });

  it('runs retry orchestration and returns the number actually attempted', async () => {
    vi.mocked(retryGitSync).mockResolvedValue(2);
    const request = new NextRequest('http://localhost/api/knowledge/git/retry', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        origin: 'http://localhost',
        host: 'localhost',
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { retried: 2 } });
    expect(retryGitSync).toHaveBeenCalledOnce();
  });
});
