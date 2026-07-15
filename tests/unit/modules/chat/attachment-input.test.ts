import { afterEach, describe, expect, it, vi } from 'vitest';

const readFile = vi.fn();
vi.mock('node:fs/promises', () => ({ readFile, default: { readFile } }));

describe('chat attachment model input', () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.DATA_ROOT;
  });

  it('reads images from DATA_ROOT/uploads and encodes them', async () => {
    process.env.DATA_ROOT = '/custom/data';
    readFile.mockResolvedValue(Buffer.from('image'));
    const { loadAttachmentImages } = await import('@/modules/chat/attachment-input');

    const images = await loadAttachmentImages([
      {
        relativePath: 'chat/2026/07/image.png',
        mimeType: 'image/png',
      } as any,
    ]);

    expect(readFile).toHaveBeenCalledWith('/custom/data/uploads/chat/2026/07/image.png');
    expect(images).toEqual([{ base64: Buffer.from('image').toString('base64'), mediaType: 'image/png' }]);
  });

  it('rejects a traversal path without reading it', async () => {
    const { loadAttachmentImages } = await import('@/modules/chat/attachment-input');

    await expect(
      loadAttachmentImages([{ relativePath: '../secret.png', mimeType: 'image/png' } as any]),
    ).rejects.toThrow('附件路径无效');
    expect(readFile).not.toHaveBeenCalled();
  });
});
