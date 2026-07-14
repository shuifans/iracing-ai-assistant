import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock env (mutate MODEL_SWITCH_PASSWORD_HASH per-test)
vi.mock('@/config/env', () => ({
  env: {
    MODEL_SWITCH_PASSWORD_HASH: '',
  },
}));

// Mock auth token-service so the real middleware resolves a user
vi.mock('@/modules/auth/token-service', () => ({
  verifyAccessToken: vi.fn(),
}));

// Mock password verification
vi.mock('@/modules/auth/password', () => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
}));

// Mock system-settings repository
vi.mock('@/modules/system-settings/repository', () => ({
  getCleaningBackend: vi.fn(),
  upsertSetting: vi.fn(),
  CLEANING_BACKENDS: ['llm-direct', 'qoder-sdk'] as const,
  CLEANING_BACKEND_KEY: 'knowledge.cleaning_backend',
}));

// Mock audit
vi.mock('@/modules/audit/service', () => ({
  recordAudit: vi.fn(),
}));

import { env } from '@/config/env';
import { verifyAccessToken } from '@/modules/auth/token-service';
import { verifyPassword } from '@/modules/auth/password';
import { getCleaningBackend, upsertSetting } from '@/modules/system-settings/repository';
import { recordAudit } from '@/modules/audit/service';
import { GET, POST } from '@/app/api/knowledge/cleaning-backend/route';

const ADMIN_USER = { id: 'user-1', role: 'admin', status: 'active' };

function makeRequest(method: 'GET' | 'POST', body?: unknown): NextRequest {
  const headers: Record<string, string> = { authorization: 'Bearer test-token' };
  let init;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init = { method, headers, body: JSON.stringify(body) };
  } else {
    init = { method, headers };
  }
  return new NextRequest('http://localhost/api/knowledge/cleaning-backend', init);
}

describe('/api/knowledge/cleaning-backend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (env as any).MODEL_SWITCH_PASSWORD_HASH = '';
    vi.mocked(verifyAccessToken).mockResolvedValue(ADMIN_USER as any);
    vi.mocked(verifyPassword).mockResolvedValue(false);
    vi.mocked(getCleaningBackend).mockReturnValue('llm-direct');
  });

  describe('GET', () => {
    it('returns the current backend', async () => {
      vi.mocked(getCleaningBackend).mockReturnValue('qoder-sdk');

      const res = await GET(makeRequest('GET'));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.backend).toBe('qoder-sdk');
    });

    it('rejects a non-admin/knowledge_admin user with 403', async () => {
      vi.mocked(verifyAccessToken).mockResolvedValue({ id: 'u', role: 'user', status: 'active' } as any);

      const res = await GET(makeRequest('GET'));

      expect(res.status).toBe(403);
    });
  });

  describe('POST', () => {
    it('switches the backend with the correct password and audits from→to', async () => {
      (env as any).MODEL_SWITCH_PASSWORD_HASH = '$2b$12$validhash';
      vi.mocked(verifyPassword).mockResolvedValue(true);
      vi.mocked(getCleaningBackend).mockReturnValueOnce('llm-direct').mockReturnValueOnce('qoder-sdk');

      const res = await POST(makeRequest('POST', { backend: 'qoder-sdk', password: 'secret' }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.backend).toBe('qoder-sdk');
      expect(json.data.previousBackend).toBe('llm-direct');
      expect(upsertSetting).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'knowledge.cleaning_backend', value: 'qoder-sdk' }),
      );
      expect(verifyPassword).toHaveBeenCalledWith('secret', '$2b$12$validhash');
      expect(recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'settings.updated',
          resource: 'system_setting',
          resourceId: 'knowledge.cleaning_backend',
          changes: { from: 'llm-direct', to: 'qoder-sdk' },
        }),
      );
    });

    it('returns 403 for a wrong password', async () => {
      (env as any).MODEL_SWITCH_PASSWORD_HASH = '$2b$12$validhash';
      vi.mocked(verifyPassword).mockResolvedValue(false);

      const res = await POST(makeRequest('POST', { backend: 'qoder-sdk', password: 'wrong' }));

      expect(res.status).toBe(403);
      expect(upsertSetting).not.toHaveBeenCalled();
    });

    it('returns 403 when the hash is not configured (no enumeration)', async () => {
      (env as any).MODEL_SWITCH_PASSWORD_HASH = '';

      const res = await POST(makeRequest('POST', { backend: 'qoder-sdk', password: 'anything' }));

      expect(res.status).toBe(403);
      // verifyPassword must NOT be called when the hash is absent (would throw)
      expect(verifyPassword).not.toHaveBeenCalled();
    });

    it('returns 400 for an invalid backend enum', async () => {
      (env as any).MODEL_SWITCH_PASSWORD_HASH = '$2b$12$validhash';
      vi.mocked(verifyPassword).mockResolvedValue(true);

      const res = await POST(makeRequest('POST', { backend: 'bogus', password: 'secret' }));

      expect(res.status).toBe(400);
      expect(upsertSetting).not.toHaveBeenCalled();
    });

    it('rejects a non-admin/knowledge_admin user with 403', async () => {
      (env as any).MODEL_SWITCH_PASSWORD_HASH = '$2b$12$validhash';
      vi.mocked(verifyAccessToken).mockResolvedValue({ id: 'u', role: 'user', status: 'active' } as any);

      const res = await POST(makeRequest('POST', { backend: 'qoder-sdk', password: 'secret' }));

      expect(res.status).toBe(403);
      expect(upsertSetting).not.toHaveBeenCalled();
    });
  });
});
