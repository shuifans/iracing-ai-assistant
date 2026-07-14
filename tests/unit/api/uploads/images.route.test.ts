import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ id: 'user-1', role: 'user', status: 'active' })),
  requireActiveUser: vi.fn(),
  validateOrigin: vi.fn(),
  withErrorHandler: (handler: unknown) => handler,
}));
vi.mock('@/modules/chat/repository', () => ({ createAttachment: vi.fn() }));

describe('POST /api/uploads/images fast validation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects an oversized Blob without reading arrayBuffer', async () => {
    const blob = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'image/png' });
    const arrayBuffer = vi.spyOn(blob, 'arrayBuffer');
    const request = { formData: vi.fn(async () => ({ get: () => blob })) } as any;
    const { POST } = await import('@/app/api/uploads/images/route');

    await expect(POST(request)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('rejects a declared non-image MIME without reading arrayBuffer', async () => {
    const blob = new Blob(['not an image'], { type: 'application/octet-stream' });
    const arrayBuffer = vi.spyOn(blob, 'arrayBuffer');
    const request = { formData: vi.fn(async () => ({ get: () => blob })) } as any;
    const { POST } = await import('@/app/api/uploads/images/route');

    await expect(POST(request)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});
